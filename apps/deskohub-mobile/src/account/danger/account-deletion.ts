import {
  type CustomerAccountDeletionResult,
  type CustomerAccountState,
  RequestCustomerAccountDeletion,
} from "@deskohub/workspace-customer-api";
import { Cause, Effect, Exit, Match, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { ReauthenticationOutcome } from "../../auth/reauthentication";
import { CustomerApi } from "../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import { customerWrite } from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  viewErrorOf,
} from "../../customer-api/customer-view-error";
import { accountIndexModel } from "../account-gating";

/**
 * What the danger zone offers the account: deletion, a retry of the pending
 * deletion, or nothing (a review account, or deletion the API withholds),
 * as the Account tab's gates decide.
 */
export type DeletionOffer = "offered" | "pending" | "withheld";

export const deletionOffer = (account: CustomerAccountState): DeletionOffer => {
  const model = accountIndexModel(account);
  if (!model.sections.includes("danger")) return "withheld";
  return model.deletionPending ? "pending" : "offered";
};

const isUnconfirmed = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) &&
  Option.exists(Cause.findErrorOption(exit.cause), (error) =>
    Predicate.isTagged(error, "CustomerWriteUnconfirmed")
  );

/**
 * POST /account/deletion { confirmed: true }. Every outcome but `deleted`
 * (and an unconfirmed write) refetches the account, which may now show the
 * deletion pending. A deleted account is not refetched: its session is gone,
 * and the 401 would only race the sign-out that ends its registry.
 */
export const requestAccountDeletionAtom = customerDataRuntime.fn(
  (_: undefined, get) =>
    Effect.all([
      Schema.decodeEffect(RequestCustomerAccountDeletion)({
        confirmed: true,
      }),
      Effect.service(CustomerApi),
    ]).pipe(
      Effect.flatMap(([payload, api]) =>
        api.account.requestDeletion({ payload }).pipe(customerWrite)
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const accountRemains = Exit.isSuccess(exit)
            ? exit.value.status !== "deleted"
            : isUnconfirmed(exit);
          if (accountRemains) get.refresh(accountAtom);
        })
      ),
      Effect.withSpan("Account.requestDeletion")
    )
);

/** How one deletion attempt ended, as the danger zone shows it. */
export type DeletionAttempt =
  | { readonly kind: CustomerAccountDeletionResult["status"] }
  /** Sent, but the answer never arrived; the account was refetched. */
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "request-failed"; readonly error: CustomerViewError };

export const deletionAttemptOf = <E extends CustomerRequestFailure>(
  exit: Exit.Exit<CustomerAccountDeletionResult, E>
): DeletionAttempt =>
  Exit.match(exit, {
    onSuccess: ({ status }) => ({ kind: status }),
    onFailure: (cause) => {
      const error = viewErrorOf(cause);
      return error._tag === "Unconfirmed"
        ? { kind: "unconfirmed" }
        : { kind: "request-failed", error };
    },
  });

/**
 * The danger zone's screen for the account and the last attempt, as the
 * boards show them: the account can't be deleted in the app (withheld), the
 * last attempt was refused (final for this visit: nothing changed and won't)
 * or failed (retry, or contact us), the deletion is pending (retry), or the
 * consequences before deleting. Each offering screen's delete (or retry)
 * button is enabled once the customer has confirmed.
 */
export type DeleteScreenView =
  | { readonly kind: "withheld" }
  | { readonly kind: "refused" }
  | {
      readonly kind: "failed" | "pending" | "consequences";
      readonly deleteAction: "disabled" | "enabled";
    };

export const deleteScreenView = (
  account: CustomerAccountState,
  {
    confirmed,
    attempt,
  }: {
    readonly confirmed: boolean;
    readonly attempt: DeletionAttempt | undefined;
  }
): DeleteScreenView => {
  const offer = deletionOffer(account);
  if (offer === "withheld") return { kind: "withheld" };
  if (attempt?.kind === "refused") return { kind: "refused" };
  const deleteAction = confirmed ? "enabled" : "disabled";
  if (attempt?.kind === "failed") return { kind: "failed", deleteAction };
  return {
    kind: offer === "pending" ? "pending" : "consequences",
    deleteAction,
  };
};

/**
 * Whether the screen offers Contact us: deleting here isn't possible or
 * didn't work, so writing to us is the way forward.
 */
export const offersContact = (view: DeleteScreenView) =>
  view.kind === "withheld" || view.kind === "refused" || view.kind === "failed";

/**
 * Whether the dialog may send the deletion now: the account was read afresh
 * (not still refetching after the last attempt, not failing) and its screen
 * still offers deletion with the customer's confirmation.
 */
export const deletionSubmittable = (
  account: AsyncResult.AsyncResult<CustomerAccountState, unknown>,
  choice: {
    readonly confirmed: boolean;
    readonly attempt: DeletionAttempt | undefined;
  }
) => {
  if (!AsyncResult.isSuccess(account) || account.waiting) return false;
  const view = deleteScreenView(account.value, choice);
  return "deleteAction" in view && view.deleteAction === "enabled";
};

/**
 * Where the deletion dialog stands. `confirm` is the last check (after a
 * sign-in it says the customer signed in again); `reauthenticate` asks the
 * customer to confirm it's them, first or again after a cancelled or failed
 * sign-in. `deleting`, `reauthenticating` and `leaving` (the account was
 * deleted, the sign-out runs) are busy: nothing dismisses them.
 */
export type DeletionDialog =
  | { readonly step: "closed" }
  | { readonly step: "confirm"; readonly signedInAgain: boolean }
  | { readonly step: "deleting"; readonly signedInAgain: boolean }
  /** After the server asked, or after a sign-in that didn't confirm it. */
  | { readonly step: "reauthenticate"; readonly after: "server" | "sign-in" }
  | { readonly step: "reauthenticating" }
  | { readonly step: "leaving" };

/** The confirmation, the dialog and the last attempt the screen shows. */
export interface DeletionFlow {
  readonly confirmed: boolean;
  readonly dialog: DeletionDialog;
  readonly attempt: DeletionAttempt | undefined;
}

export const startingDeletionFlow: DeletionFlow = {
  confirmed: false,
  dialog: { step: "closed" },
  attempt: undefined,
};

export type DeletionFlowEvent =
  | { readonly type: "confirmation"; readonly confirmed: boolean }
  /** "Delete my account" (or "Try deleting again") on the screen. */
  | { readonly type: "open" }
  /** "Keep account" or "Cancel", the back button or the scrim. */
  | { readonly type: "keep" }
  /** "Delete permanently": the request is sent. */
  | { readonly type: "delete" }
  | { readonly type: "answered"; readonly attempt: DeletionAttempt }
  /** "Continue to sign in" or "Try again". */
  | { readonly type: "sign-in" }
  | { readonly type: "signed-in"; readonly outcome: ReauthenticationOutcome }
  /** The web sign-in page confirmed it's them and returned here. */
  | { readonly type: "resumed" }
  /** The refetched account no longer offers deletion under the open dialog. */
  | { readonly type: "withdrawn" };

export const deletionDialogBusy = (dialog: DeletionDialog) =>
  dialog.step === "deleting" ||
  dialog.step === "reauthenticating" ||
  dialog.step === "leaving";

/** Whether an attempt's outcome shows on the screen rather than in the dialog. */
export const shownOnScreen = (attempt: DeletionAttempt | undefined) =>
  attempt !== undefined &&
  (attempt.kind === "failed" ||
    attempt.kind === "refused" ||
    attempt.kind === "unconfirmed");

/**
 * The dialog after the server answers: a deleted account leaves; a stale
 * sign-in asks the customer to confirm it's them (the server alone decides
 * the session is too old); a request that never got an answer stays on the
 * last check to send again; every other outcome closes the dialog and shows
 * on the screen.
 */
const dialogAfter = (
  attempt: DeletionAttempt,
  signedInAgain: boolean
): DeletionDialog =>
  Match.value(attempt).pipe(
    Match.discriminatorsExhaustive("kind")({
      deleted: () => ({ step: "leaving" }) as const,
      "reauthentication-required": () =>
        ({ step: "reauthenticate", after: "server" }) as const,
      "request-failed": () => ({ step: "confirm", signedInAgain }) as const,
      failed: () => ({ step: "closed" }) as const,
      refused: () => ({ step: "closed" }) as const,
      unconfirmed: () => ({ step: "closed" }) as const,
    })
  );

/**
 * One step of the deletion flow. Keeping the account clears the
 * confirmation, so a second tap can't slip through; a confirmed sign-in
 * returns to the last check instead of repeating the flow.
 */
export const deletionFlowAfter = (
  flow: DeletionFlow,
  event: DeletionFlowEvent
): DeletionFlow => {
  const { dialog } = flow;
  switch (event.type) {
    case "confirmation":
      return dialog.step === "closed"
        ? { ...flow, confirmed: event.confirmed }
        : flow;
    case "open":
      return dialog.step === "closed" && flow.confirmed
        ? {
            ...flow,
            // What the last dialog said belongs to it.
            attempt: shownOnScreen(flow.attempt) ? flow.attempt : undefined,
            dialog: { step: "confirm", signedInAgain: false },
          }
        : flow;
    case "keep":
      return dialog.step === "closed" || deletionDialogBusy(dialog)
        ? flow
        : { ...flow, confirmed: false, dialog: { step: "closed" } };
    case "delete":
      return dialog.step === "confirm"
        ? {
            ...flow,
            dialog: { step: "deleting", signedInAgain: dialog.signedInAgain },
          }
        : flow;
    case "answered":
      return dialog.step === "deleting"
        ? {
            ...flow,
            attempt: event.attempt,
            dialog: dialogAfter(event.attempt, dialog.signedInAgain),
          }
        : flow;
    case "sign-in":
      return dialog.step === "reauthenticate"
        ? { ...flow, dialog: { step: "reauthenticating" } }
        : flow;
    case "signed-in":
      if (dialog.step !== "reauthenticating") return flow;
      return Match.value(event.outcome).pipe(
        Match.withReturnType<DeletionFlow>(),
        Match.when("reauthenticated", () => ({
          ...flow,
          // The stale sign-in no longer applies.
          attempt: undefined,
          dialog: { step: "confirm", signedInAgain: true },
        })),
        // Cancelled or failed: the hook's state says which.
        Match.when("failed", () => ({
          ...flow,
          dialog: { step: "reauthenticate", after: "sign-in" },
        })),
        // The web sign-in page took over and returns to this screen.
        Match.when("redirected", () => ({
          ...flow,
          dialog: { step: "reauthenticate", after: "server" },
        })),
        // Another sign-in is under way and answers for itself.
        Match.when("busy", () => flow),
        Match.exhaustive
      );
    case "resumed":
      return dialog.step === "closed"
        ? {
            confirmed: true,
            attempt: undefined,
            dialog: { step: "confirm", signedInAgain: true },
          }
        : flow;
    case "withdrawn":
      return deletionDialogBusy(dialog)
        ? flow
        : { ...flow, attempt: undefined, dialog: { step: "closed" } };
  }
};
