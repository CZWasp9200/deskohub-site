import { Effect } from "effect";
import type {
  CustomerProfileInput,
  ProfileCompletionReferralOutcome,
} from "../contracts";
import type { CustomerAccountId } from "../customer-account";
import { CustomerProfileService } from "./customer-profile.service";
import {
  describeSignupReferral,
  prepareSignupReferral,
  recordSignupReferral,
} from "./signup-referral";

export type NewCustomerProfileCompletion =
  | { readonly status: "referral-code-unavailable" }
  | {
      readonly status: "completed";
      /** Present when a referral code was kept for this completion. */
      readonly referral?: ProfileCompletionReferralOutcome;
    };

/**
 * First-time completion of a not-yet-linked account. A usable referral code
 * is stored with the new link in one transaction, so only the completion that
 * creates the link owns a code. It is recorded after the account lock is
 * released, because acceptance takes that lock in its own transaction. A
 * completion that finds the link already created stores nothing and reports
 * its code against the account's current referral state.
 */
export const completeNewCustomerProfile = Effect.fn(
  "account.completeNewCustomerProfile"
)(function* (
  user: { readonly accountId: CustomerAccountId; readonly email: string },
  input: CustomerProfileInput,
  referral: {
    readonly code: string | undefined;
    readonly prefilledCode: string | undefined;
  }
) {
  const request = yield* prepareSignupReferral(referral);
  if (request.kind === "unavailable") {
    return { status: "referral-code-unavailable" } as const;
  }
  const intent = request.kind === "intent" ? request.intent : undefined;

  const creation = yield* Effect.flatMap(CustomerProfileService, (profile) =>
    profile.create(user.accountId, user.email, input, intent)
  );
  if (intent === undefined) return { status: "completed" } as const;

  const recorded = creation.created
    ? yield* recordSignupReferral(creation.account).pipe(
        Effect.orElseSucceed(() => undefined)
      )
    : undefined;
  const outcome =
    recorded ??
    (yield* describeSignupReferral(creation.account, intent, creation.created));
  return {
    status: "completed",
    referral: outcome,
  } satisfies NewCustomerProfileCompletion;
});
