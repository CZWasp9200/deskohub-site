import { describe, expect, test } from "bun:test";
import { RegistryContext } from "@effect/atom-react";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { completeProfileAtom } from "../profile/profile-save";
import {
  type CompletionRequiredAccount,
  useOnboardingDraft,
} from "./onboarding-draft";

type OnboardingDraft = ReturnType<typeof useOnboardingDraft>;

/**
 * A step of onboarding as far as its draft goes: each shown step reads and
 * edits the one completion draft through `useOnboardingDraft`. A render
 * shows the steps on screen now; a step left out has gone.
 */
const steps: Partial<Record<string, OnboardingDraft>> = {};
function Step({
  name,
  account,
}: {
  readonly name: string;
  readonly account: CompletionRequiredAccount;
}) {
  steps[name] = useOnboardingDraft(account);
  return null;
}

const step = (name: string) => {
  const found = steps[name];
  if (found === undefined) throw new Error(`step ${name} isn't mounted`);
  return found;
};

/** A completion-required account over a fake Workspace, with steps to mount. */
const onboarding = async () => {
  const { registry, workspace } = makeFakeCustomerData("completion-required");
  const read = await settle(registry, accountAtom);
  const account = read._tag === "Success" ? read.success : undefined;
  if (account?.kind !== "completion-required")
    throw new Error("expected an account that needs a profile");
  const show = (...names: ReadonlyArray<string>) => {
    for (const name of Object.keys(steps)) delete steps[name];
    renderToStaticMarkup(
      <RegistryContext value={registry}>
        {names.map((name) => (
          <Step key={name} name={name} account={account} />
        ))}
      </RegistryContext>
    );
  };
  /** Waits for the submit to settle, then shows `names` again. */
  const submitted = async (...names: ReadonlyArray<string>) => {
    await Effect.runPromise(
      Effect.result(
        AtomRegistry.getResult(completeProfileAtom, {
          suspendOnWaiting: true,
        })(registry)
      )
    );
    show(...names);
  };
  return { registry, workspace, show, submitted };
};

/** Edits the draft from step `name`, then shows the steps again. */
const editing =
  (show: (...names: ReadonlyArray<string>) => void) =>
  (
    name: string,
    change: Parameters<OnboardingDraft["change"]>[0],
    ...shown: ReadonlyArray<string>
  ) => {
    step(name).change(change);
    show(...(shown.length === 0 ? [name] : shown));
  };

describe("onboarding draft", () => {
  test("what About you holds is there on Billing details, and back again", async () => {
    const { show } = await onboarding();
    const edit = editing(show);
    show("about-you");
    edit("about-you", { firstName: "Jordan", phone: "+420 777 000 111" });

    show("about-you", "billing");
    expect(step("billing").draft).toMatchObject({
      firstName: "Jordan",
      phone: "+420 777 000 111",
    });
    edit(
      "billing",
      { billingKind: "personal", city: "Brno" },
      "about-you",
      "billing"
    );

    show("about-you");
    expect(step("about-you").draft).toMatchObject({
      firstName: "Jordan",
      billingKind: "personal",
      city: "Brno",
    });
  });

  test("closing onboarding and opening it again keeps the answers", async () => {
    const { show } = await onboarding();
    const edit = editing(show);
    show("about-you");
    edit("about-you", { firstName: "Jordan", lastName: "Sample" });

    show();
    show("about-you");

    expect(step("about-you").draft).toMatchObject({
      firstName: "Jordan",
      lastName: "Sample",
    });
  });

  test("switching billing kinds keeps the company typed earlier", async () => {
    const { show } = await onboarding();
    const edit = editing(show);
    show("billing");
    edit("billing", { billingKind: "business", companyName: "Sample" });
    edit("billing", { billingKind: "personal" });
    edit("billing", { billingKind: "business" });

    expect(step("billing").draft.companyName).toBe("Sample");
  });
});

describe("onboarding submit", () => {
  const both = ["about-you", "billing"] as const;

  test("Create profile sends both steps' answers in one request", async () => {
    const { show, workspace, submitted } = await onboarding();
    const edit = editing(show);
    show(...both);
    edit("about-you", { firstName: "Jordan" }, ...both);
    edit(
      "billing",
      {
        billingKind: "personal",
        addressLine1: "Sample street 1",
        city: "Brno",
        zip: "60200",
        country: "CZ",
      },
      ...both
    );

    step("billing").submit();
    await submitted(...both);

    expect(
      workspace.calls.filter((call) => call === "completeProfile")
    ).toHaveLength(1);
    expect(workspace.data.account).toMatchObject({
      kind: "linked",
      profile: {
        firstName: "Jordan",
        billing: { kind: "personal", city: "Brno" },
      },
    });
  });

  test("a failed create keeps every answer, and trying again sends them", async () => {
    const { show, workspace, submitted } = await onboarding();
    const edit = editing(show);
    show(...both);
    edit("about-you", { firstName: "Jordan" }, ...both);
    workspace.fail("completeProfile", "service-unavailable");

    step("billing").submit();
    await submitted(...both);
    expect(step("billing").state._tag).toBe("Failed");
    expect(step("about-you").draft.firstName).toBe("Jordan");
    expect(workspace.data.account.kind).toBe("completion-required");

    step("billing").submit();
    await submitted(...both);
    expect(step("billing").state._tag).toBe("Done");
    expect(workspace.data.account.kind).toBe("linked");
  });

  test("an error on About you found at the submit names that step's field", async () => {
    const { show, workspace, submitted } = await onboarding();
    const edit = editing(show);
    show(...both);
    edit("about-you", { firstName: "Jordan", referralCode: "NOPE" }, ...both);
    workspace.referralCodeAnswer = "unavailable";

    step("billing").submit();
    await submitted(...both);

    const state = step("about-you").state;
    expect(state._tag === "Invalid" && state.invalid.fields).toEqual({
      referralCode: "invalid",
    });
  });

  test("an edit after a refused submit clears its problems", async () => {
    const { show, submitted } = await onboarding();
    const edit = editing(show);
    show("billing");
    step("billing").submit();
    await submitted("billing");
    expect(step("billing").state._tag).toBe("Invalid");

    edit("billing", { firstName: "Jordan" });

    expect(step("billing").state._tag).toBe("Idle");
  });
});
