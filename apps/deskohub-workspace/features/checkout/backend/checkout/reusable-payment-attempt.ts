import "@/shared/polyfills/temporal";

import { getPaymentAttemptAbandonmentCutoff } from "@/features/checkout/provider-order-abandonment";
import type { PaymentAttempt } from "../repositories/payment-attempt.repository";
import type { PaymentPageProviderObservation } from "./payment-page-provider-status";

/** An attempt whose provider session hasn't settled or ended. */
export const isReusableAttemptState = (state: PaymentAttempt["state"]) =>
  state === "created" || state === "pending";

/**
 * The stored hosted payment page of an attempt that hasn't settled or ended,
 * or `undefined` when there is none to open again. Opening it again starts no
 * new payment: the page belongs to the attempt's one provider order.
 */
export const getReusableProviderRedirectUrl = (
  attempt: Pick<
    PaymentAttempt,
    "providerRedirectUrl" | "securityToken" | "state"
  >
) =>
  isReusableAttemptState(attempt.state) &&
  attempt.securityToken &&
  attempt.providerRedirectUrl
    ? attempt.providerRedirectUrl
    : undefined;

/**
 * How long after its provider order was created a stored hosted payment page
 * is offered again when the provider can't be asked. The provider's answer
 * decides otherwise (`decidePaymentPageReopening`).
 *
 * Provisional: 6 minutes comes from one Nexi sandbox run
 * (~/.cache/ux-mobile/build/1243/sandbox-reopen.md, 2026-11-15: the order
 * was cancelled at about 6.6 minutes; reopening at 10, 20 and 29 minutes
 * showed the error page). Production may differ and nobody has measured it.
 */
const paymentPageReopeningWindowMinutes = 6;

/**
 * When the order's stored payment page stops being offered again while the
 * provider can't be asked. An attempt stored without its provider order's
 * creation time counts from its own creation, which came first.
 */
const getPaymentPageReopeningCutoff = (
  attempt: Pick<PaymentAttempt, "providerOrderCreatedAt" | "createdAt">
) =>
  (attempt.providerOrderCreatedAt ?? attempt.createdAt).add({
    minutes: paymentPageReopeningWindowMinutes,
  });

type ReopeningAttempt = Pick<
  PaymentAttempt,
  | "providerRedirectUrl"
  | "securityToken"
  | "state"
  | "providerOrderCreatedAt"
  | "createdAt"
>;

/**
 * Why a stored payment page isn't offered again: the attempt has none that
 * is still open, or the page no longer takes a payment (the provider
 * recorded activity on its order, or, unasked, its reopening window ended).
 */
type PaymentPageClosure = "no_active_attempt" | "window_elapsed";

/**
 * The stored page of an attempt that may still take a payment, before the
 * provider is asked: the attempt hasn't settled or ended, and its local
 * abandonment window hasn't ended either.
 */
export const getPaymentPageToReopen = (
  attempt: ReopeningAttempt,
  now: Temporal.Instant
):
  | { readonly providerRedirectUrl: string }
  | { readonly closed: PaymentPageClosure } => {
  const providerRedirectUrl = getReusableProviderRedirectUrl(attempt);
  if (!providerRedirectUrl) return { closed: "no_active_attempt" };
  if (
    Temporal.Instant.compare(
      now,
      getPaymentAttemptAbandonmentCutoff(attempt)
    ) >= 0
  ) {
    return { closed: "window_elapsed" };
  }
  return { providerRedirectUrl };
};

/**
 * Whether a page `getPaymentPageToReopen` returned is offered again, given
 * what the provider's order shows: offered while the order shows no
 * activity, and, when the provider couldn't be asked, only within the
 * provisional reopening window. `now` is read after the provider answered:
 * an answer that arrives after the abandonment cutoff opens nothing.
 */
export const decidePaymentPageReopening = (
  attempt: ReopeningAttempt,
  now: Temporal.Instant,
  observation: PaymentPageProviderObservation
): "open" | PaymentPageClosure => {
  if (
    Temporal.Instant.compare(
      now,
      getPaymentAttemptAbandonmentCutoff(attempt)
    ) >= 0
  ) {
    return "window_elapsed";
  }
  if (observation === "no_activity") return "open";
  if (
    observation === "unknown" &&
    Temporal.Instant.compare(now, getPaymentPageReopeningCutoff(attempt)) < 0
  ) {
    return "open";
  }
  return "window_elapsed";
};

/**
 * Whether the order's payment has started and not ended, or has settled: its
 * price, codes and referral can no longer change. An order whose last attempt
 * failed, was cancelled or expired may still be repriced before a retry.
 */
export const hasPaymentInProgress = (order: {
  readonly paymentState: string;
}) => order.paymentState === "pending" || order.paymentState === "paid";
