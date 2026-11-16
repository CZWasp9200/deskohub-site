import type { PaymentAttempt } from "../repositories/payment-attempt.repository";

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
 * is offered again. Nexi cancels the order of an abandoned page well before
 * the 30-minute local abandonment window ends, and the page then shows only
 * its error page, so offering it is cut short here.
 *
 * Provisional: 6 minutes comes from one Nexi sandbox run
 * (~/.cache/ux-mobile/build/1243/sandbox-reopen.md, 2026-11-15: the order
 * was cancelled at about 6.6 minutes; reopening at 10, 20 and 29 minutes
 * showed the error page). Production may differ and nobody has measured it.
 * A provider-side status check before reopening (ticket #1243 part 2a)
 * replaces this setting.
 */
const paymentPageReopeningWindowMinutes = 6;

/**
 * When the order's stored payment page stops being offered again. An attempt
 * stored without its provider order's creation time counts from its own
 * creation, which came first.
 */
export const getPaymentPageReopeningCutoff = (
  attempt: Pick<PaymentAttempt, "providerOrderCreatedAt" | "createdAt">
) =>
  (attempt.providerOrderCreatedAt ?? attempt.createdAt).add({
    minutes: paymentPageReopeningWindowMinutes,
  });

/** Whether the attempt's stored payment page may be offered again at `now`. */
export const isPaymentPageReopenable = (
  attempt: Pick<
    PaymentAttempt,
    | "providerRedirectUrl"
    | "securityToken"
    | "state"
    | "providerOrderCreatedAt"
    | "createdAt"
  >,
  now: Temporal.Instant
) =>
  getReusableProviderRedirectUrl(attempt) !== undefined &&
  Temporal.Instant.compare(now, getPaymentPageReopeningCutoff(attempt)) < 0;
