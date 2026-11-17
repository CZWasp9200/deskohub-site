import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { buildCheckoutPayPath } from "./checkout-pay-url";
import { type IssuedPayState, PayState } from "./pay-state";
import { loadPayStateHoldExpiry } from "./pay-state-hold";

type PayStatePriceAcceptance = IssuedPayState & {
  /** `already_accepted`: the state had no price review; its token is returned as is. */
  readonly status: "accepted" | "already_accepted";
};

/**
 * Accepts the price change a Pay state asks the customer to review, with the
 * same continuation the Pay page links to. It touches neither the hold nor
 * the price: submission re-validates both, the continuation keeps the hold
 * deadline, and its expiry is the token's own.
 */
export const acceptPayStatePriceChange = Effect.fn(
  "checkout.acceptPayStatePriceChange"
)(function* (input: {
  readonly payStateToken: string;
  readonly locale: Locale;
}) {
  const state = yield* PayState.open(input.payStateToken, {
    locale: input.locale,
  }).pipe(Effect.flatMap(loadPayStateHoldExpiry));
  if (state.changedKeys === undefined) {
    const unchanged: PayStatePriceAcceptance = {
      status: "already_accepted",
      payStateToken: input.payStateToken,
      payUrl: buildCheckoutPayPath(input.locale, input.payStateToken),
      expiresAt: PayState.expiresAt(state),
    };
    return unchanged;
  }
  const continuation = yield* PayState.reissue(state, { kind: "reviewed" });
  const accepted: PayStatePriceAcceptance = {
    status: "accepted",
    ...continuation,
  };
  return accepted;
});
