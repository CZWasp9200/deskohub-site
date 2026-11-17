import { describe, expect, test } from "bun:test";
import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import type { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import type { SampleAccountKind } from "../../customer-api/testing/sample-fixtures";
import {
  type DeletionAttempt,
  type DeletionFlowEvent,
  deleteScreenView,
  deletionAttemptOf,
  deletionFlowAfter,
  deletionOffer,
  deletionSubmittable,
  offersContact,
  requestAccountDeletionAtom,
  startingDeletionFlow,
} from "./account-deletion";

/** Reads the account, as the screen does before the customer can delete. */
const openDangerZone = async (
  kind: SampleAccountKind = "linked",
  arrange?: (workspace: FakeWorkspace) => void
) => {
  const fake = makeFakeCustomerData(kind);
  arrange?.(fake.workspace);
  fake.registry.mount(accountAtom);
  const account = await settle(fake.registry, accountAtom);
  if (account._tag !== "Success") throw new Error("account didn't load");
  return { ...fake, account: account.success };
};

/** Presses "Delete permanently" and resolves with the attempt's outcome. */
const deleteAccount = async (registry: AtomRegistry.AtomRegistry) => {
  registry.mount(requestAccountDeletionAtom);
  registry.set(requestAccountDeletionAtom, undefined);
  return deletionAttemptOf(
    await Effect.runPromiseExit(
      AtomRegistry.getResult(requestAccountDeletionAtom, {
        suspendOnWaiting: true,
      })(registry)
    )
  );
};

/** The account after the attempt's refetch (if any) settles. */
const accountAfter = async (registry: AtomRegistry.AtomRegistry) => {
  const account = await settle(registry, accountAtom);
  if (account._tag !== "Success") throw new Error("account didn't reload");
  return account.success;
};

/** The flow once the dialog sent the deletion and the server answered. */
const answered = (attempt: DeletionAttempt) =>
  deletionFlowAfter(
    {
      confirmed: true,
      attempt: undefined,
      dialog: { step: "deleting", signedInAgain: false },
    },
    { type: "answered", attempt }
  );

const withDeletion = (
  account: CustomerAccountState,
  deletion: CustomerAccountState["deletion"]
) => ({ ...account, deletion }) as CustomerAccountState;

describe("deletionOffer", () => {
  test("offers deletion while the API offers it", async () => {
    const { account } = await openDangerZone("linked");
    expect(deletionOffer(account)).toBe("offered");
  });

  test("offers a retry while deletion is pending", async () => {
    const { account } = await openDangerZone("deletion-pending");
    expect(deletionOffer(account)).toBe("pending");
  });

  test("offers nothing while the API withholds deletion", async () => {
    const { account } = await openDangerZone("linked", (workspace) =>
      workspace.setAccount(withDeletion(workspace.data.account, "withheld"))
    );
    expect(deletionOffer(account)).toBe("withheld");
  });

  test("never offers a review account deletion, even reached directly", async () => {
    const { account } = await openDangerZone("review-account", (workspace) =>
      workspace.setAccount(withDeletion(workspace.data.account, "offered"))
    );
    expect(deletionOffer(account)).toBe("withheld");
    expect(
      deleteScreenView(account, { confirmed: true, attempt: undefined })
    ).toEqual({ kind: "withheld" });
  });
});

describe("deleteScreenView", () => {
  test("enables deleting only once the customer has confirmed", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deleteScreenView(account, { confirmed: false, attempt: undefined })
    ).toMatchObject({ deleteAction: "disabled" });
    expect(
      deleteScreenView(account, { confirmed: true, attempt: undefined })
    ).toMatchObject({ deleteAction: "enabled" });
  });

  test("gates the pending deletion's retry the same way", async () => {
    const { account } = await openDangerZone("deletion-pending");
    expect(
      deleteScreenView(account, { confirmed: false, attempt: undefined })
    ).toEqual({ kind: "pending", deleteAction: "disabled" });
    expect(
      deleteScreenView(account, { confirmed: true, attempt: undefined })
    ).toMatchObject({ deleteAction: "enabled" });
  });

  test("a refusal ends deleting for the visit", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deleteScreenView(account, {
        confirmed: true,
        attempt: { kind: "refused" },
      })
    ).toEqual({ kind: "refused" });
  });

  test("a failure offers the retry, even once the account reads pending", async () => {
    for (const kind of ["linked", "deletion-pending"] as const) {
      const { account } = await openDangerZone(kind);
      expect(
        deleteScreenView(account, {
          confirmed: true,
          attempt: { kind: "failed" },
        })
      ).toEqual({ kind: "failed", deleteAction: "enabled" });
    }
  });
});

describe("deletionSubmittable", () => {
  const choice = { confirmed: true, attempt: undefined };

  test("sends once the freshly read account offers deletion", async () => {
    const { account } = await openDangerZone("linked");
    expect(deletionSubmittable(AsyncResult.success(account), choice)).toBe(
      true
    );
  });

  test("waits while the account is refetched after the last attempt", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deletionSubmittable(
        AsyncResult.success(account, { waiting: true }),
        choice
      )
    ).toBe(false);
  });

  test("won't send once the refetched account withholds deletion", async () => {
    const { account } = await openDangerZone("linked", (workspace) =>
      workspace.setAccount(withDeletion(workspace.data.account, "withheld"))
    );
    expect(deletionSubmittable(AsyncResult.success(account), choice)).toBe(
      false
    );
  });

  test("won't send on an account it couldn't read", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deletionSubmittable(
        AsyncResult.fail("unavailable", {
          previousSuccess: Option.some(AsyncResult.success(account)),
        }),
        choice
      )
    ).toBe(false);
  });

  test("won't send without the customer's confirmation", async () => {
    const { account } = await openDangerZone("linked");
    expect(
      deletionSubmittable(AsyncResult.success(account), {
        confirmed: false,
        attempt: undefined,
      })
    ).toBe(false);
  });
});

describe("requestAccountDeletionAtom", () => {
  test("deleted: confirms the deletion and doesn't refetch the gone account", async () => {
    const { registry, workspace } = await openDangerZone("linked");

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "deleted" });
    expect(answered(attempt).dialog).toEqual({ step: "leaving" });
    expect(workspace.calls).toEqual(["getAccount", "requestDeletion"]);
    expect(workspace.signedIn).toBe(false);
  });

  test("reauthentication-required: stays in the dialog, account refetched", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "reauthentication-required";
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "reauthentication-required" });
    expect(answered(attempt).dialog).toEqual({
      step: "reauthenticate",
      after: "server",
    });
    expect(workspace.signedIn).toBe(true);
    await accountAfter(registry);
    expect(workspace.calls).toEqual([
      "getAccount",
      "requestDeletion",
      "getAccount",
    ]);
  });

  test("refused: final, shown on the screen with nothing changed", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "refused";
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "refused" });
    const flow = answered(attempt);
    expect(flow.dialog).toEqual({ step: "closed" });
    expect(deleteScreenView(await accountAfter(registry), flow)).toEqual({
      kind: "refused",
    });
    expect(workspace.signedIn).toBe(true);
  });

  test("failed: shown on the screen with a retry, and the retry can delete", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "failed";
    });

    const attempt = await deleteAccount(registry);
    expect(attempt).toEqual({ kind: "failed" });
    const flow = answered(attempt);
    expect(flow.dialog).toEqual({ step: "closed" });
    expect(deleteScreenView(await accountAfter(registry), flow)).toEqual({
      kind: "failed",
      deleteAction: "enabled",
    });

    workspace.deletionOutcome = "deleted";
    expect(await deleteAccount(registry)).toEqual({ kind: "deleted" });
  });

  test("unconfirmed: refetches and shows the deletion now pending", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "failed";
      fake.fail("requestDeletion", "transport-failure");
    });
    // The server recorded the attempt as a pending deletion.
    workspace.setAccount(withDeletion(workspace.data.account, "pending"));

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "unconfirmed" });
    const flow = answered(attempt);
    expect(flow.dialog).toEqual({ step: "closed" });
    expect(deleteScreenView(await accountAfter(registry), flow)).toEqual({
      kind: "pending",
      deleteAction: "enabled",
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "requestDeletion",
      "getAccount",
    ]);
  });

  test("unconfirmed: refetches and shows deletion still offered", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.deletionOutcome = "failed";
      fake.fail("requestDeletion", "unreadable-answer");
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toEqual({ kind: "unconfirmed" });
    expect(deletionOffer(await accountAfter(registry))).toBe("offered");
    expect(workspace.calls).toEqual([
      "getAccount",
      "requestDeletion",
      "getAccount",
    ]);
  });

  test("a request that never reached the server fails retryably in the dialog", async () => {
    const { registry, workspace } = await openDangerZone("linked", (fake) => {
      fake.fail("requestDeletion", "service-unavailable");
    });

    const attempt = await deleteAccount(registry);

    expect(attempt).toMatchObject({
      kind: "request-failed",
      error: { _tag: "Unavailable" },
    });
    expect(answered(attempt).dialog).toEqual({
      step: "confirm",
      signedInAgain: false,
    });
    expect(workspace.calls).toEqual(["getAccount", "requestDeletion"]);
    expect(workspace.signedIn).toBe(true);
  });

  test("a rate-limited request says so", async () => {
    const { registry } = await openDangerZone("linked", (fake) => {
      fake.fail("requestDeletion", "rate-limited");
    });

    expect(await deleteAccount(registry)).toMatchObject({
      kind: "request-failed",
      error: { _tag: "RateLimited" },
    });
  });

  test("a pending deletion's retry goes through the same request", async () => {
    const { registry, workspace } = await openDangerZone("deletion-pending");

    expect(await deleteAccount(registry)).toEqual({ kind: "deleted" });
    expect(workspace.calls).toEqual(["getAccount", "requestDeletion"]);
  });
});

describe("offersContact", () => {
  test("offers Contact us where deleting here isn't possible or didn't work", async () => {
    const { account } = await openDangerZone("linked");
    const view = (attempt: DeletionAttempt | undefined) =>
      deleteScreenView(account, { confirmed: true, attempt });
    expect(offersContact(view({ kind: "refused" }))).toBe(true);
    expect(offersContact(view({ kind: "failed" }))).toBe(true);
    expect(offersContact(view(undefined))).toBe(false);
    const withheld = await openDangerZone("review-account");
    expect(
      offersContact(
        deleteScreenView(withheld.account, {
          confirmed: false,
          attempt: undefined,
        })
      )
    ).toBe(true);
    const pending = await openDangerZone("deletion-pending");
    expect(
      offersContact(
        deleteScreenView(pending.account, {
          confirmed: true,
          attempt: undefined,
        })
      )
    ).toBe(false);
  });
});

describe("deletionFlowAfter", () => {
  const run = (...events: ReadonlyArray<DeletionFlowEvent>) =>
    events.reduce(deletionFlowAfter, startingDeletionFlow);
  const toLastCheck: ReadonlyArray<DeletionFlowEvent> = [
    { type: "confirmation", confirmed: true },
    { type: "open" },
  ];
  const toSignIn: ReadonlyArray<DeletionFlowEvent> = [
    ...toLastCheck,
    { type: "delete" },
    { type: "answered", attempt: { kind: "reauthentication-required" } },
  ];

  test("the last check opens only once the customer has confirmed", () => {
    expect(run({ type: "open" }).dialog).toEqual({ step: "closed" });
    expect(run(...toLastCheck).dialog).toEqual({
      step: "confirm",
      signedInAgain: false,
    });
  });

  test("keeping the account closes the dialog and clears the confirmation", () => {
    expect(run(...toLastCheck, { type: "keep" })).toEqual(startingDeletionFlow);
    expect(run(...toSignIn, { type: "keep" })).toMatchObject({
      confirmed: false,
      dialog: { step: "closed" },
    });
  });

  test("nothing dismisses the dialog while the server or a sign-in decides", () => {
    const deleting = run(...toLastCheck, { type: "delete" });
    expect(deletionFlowAfter(deleting, { type: "keep" })).toBe(deleting);
    expect(deletionFlowAfter(deleting, { type: "withdrawn" })).toBe(deleting);
    const signingIn = run(...toSignIn, { type: "sign-in" });
    expect(deletionFlowAfter(signingIn, { type: "keep" })).toBe(signingIn);
    const leaving = run(
      ...toLastCheck,
      { type: "delete" },
      { type: "answered", attempt: { kind: "deleted" } }
    );
    expect(leaving.dialog).toEqual({ step: "leaving" });
    expect(deletionFlowAfter(leaving, { type: "keep" })).toBe(leaving);
  });

  test("asks the customer to confirm it's them only when the server asks", () => {
    const answers: ReadonlyArray<DeletionAttempt> = [
      { kind: "deleted" },
      { kind: "failed" },
      { kind: "refused" },
      { kind: "unconfirmed" },
      { kind: "request-failed", error: CustomerViewError.Unavailable() },
    ];
    for (const attempt of answers) {
      expect(answered(attempt).dialog.step).not.toBe("reauthenticate");
    }
    expect(run(...toSignIn).dialog).toEqual({
      step: "reauthenticate",
      after: "server",
    });
    // Nothing is sent from there until the customer continues.
    expect(deletionFlowAfter(run(...toSignIn), { type: "delete" })).toEqual(
      run(...toSignIn)
    );
  });

  test("a confirmed sign-in resumes at the last check, which sends again", () => {
    const resumed = run(
      ...toSignIn,
      { type: "sign-in" },
      { type: "signed-in", outcome: "reauthenticated" }
    );
    expect(resumed).toEqual({
      confirmed: true,
      attempt: undefined,
      dialog: { step: "confirm", signedInAgain: true },
    });
    expect(deletionFlowAfter(resumed, { type: "delete" }).dialog).toEqual({
      step: "deleting",
      signedInAgain: true,
    });
  });

  test("a cancelled or failed sign-in asks again, a running one changes nothing", () => {
    const signingIn = run(...toSignIn, { type: "sign-in" });
    expect(
      deletionFlowAfter(signingIn, { type: "signed-in", outcome: "failed" })
        .dialog
    ).toEqual({ step: "reauthenticate", after: "sign-in" });
    expect(
      deletionFlowAfter(signingIn, { type: "signed-in", outcome: "busy" })
    ).toBe(signingIn);
    expect(
      run(
        ...toSignIn,
        { type: "sign-in" },
        { type: "signed-in", outcome: "failed" },
        { type: "sign-in" },
        { type: "signed-in", outcome: "reauthenticated" }
      ).dialog
    ).toEqual({ step: "confirm", signedInAgain: true });
  });

  test("the web sign-in's return resumes at the last check, confirmed", () => {
    expect(run({ type: "resumed" })).toEqual({
      confirmed: true,
      attempt: undefined,
      dialog: { step: "confirm", signedInAgain: true },
    });
    const open = run(...toLastCheck);
    expect(deletionFlowAfter(open, { type: "resumed" })).toBe(open);
  });

  test("a retry reopens the last check over the failure it retries", () => {
    const failed = run(
      ...toLastCheck,
      { type: "delete" },
      { type: "answered", attempt: { kind: "failed" } }
    );
    expect(failed.dialog).toEqual({ step: "closed" });
    expect(failed.confirmed).toBe(true);
    const retry = deletionFlowAfter(failed, { type: "open" });
    expect(retry.attempt).toEqual({ kind: "failed" });
    expect(retry.dialog).toEqual({ step: "confirm", signedInAgain: false });
  });

  test("a request failure belongs to its dialog, not the next one", () => {
    const unsent = run(
      ...toLastCheck,
      { type: "delete" },
      {
        type: "answered",
        attempt: {
          kind: "request-failed",
          error: CustomerViewError.Unavailable(),
        },
      }
    );
    expect(unsent.dialog).toEqual({ step: "confirm", signedInAgain: false });
    expect(
      run(
        ...toLastCheck,
        { type: "delete" },
        {
          type: "answered",
          attempt: {
            kind: "request-failed",
            error: CustomerViewError.Unavailable(),
          },
        },
        { type: "keep" },
        { type: "confirmation", confirmed: true },
        { type: "open" }
      ).attempt
    ).toBeUndefined();
  });

  test("the confirmation can't change under the open dialog", () => {
    const open = run(...toLastCheck);
    expect(
      deletionFlowAfter(open, { type: "confirmation", confirmed: false })
    ).toBe(open);
  });

  test("an account that stops offering deletion closes the dialog", () => {
    expect(run(...toLastCheck, { type: "withdrawn" }).dialog).toEqual({
      step: "closed",
    });
  });
});
