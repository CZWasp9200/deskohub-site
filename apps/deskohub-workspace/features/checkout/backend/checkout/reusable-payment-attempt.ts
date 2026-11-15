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
