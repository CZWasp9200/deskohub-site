const providerOrderAbandonmentTimeoutMinutes = 30;

type ProviderOrderState = {
  readonly operationCount: number;
  readonly authorizedAmount?: string;
  readonly capturedAmount?: string;
};

const isAbsentOrZeroProviderAmount = (value: string | undefined) =>
  value === undefined || /^0+(?:\.0+)?$/.test(value.trim());

export const hasProviderPaymentActivity = (order: ProviderOrderState) =>
  order.operationCount > 0 ||
  !isAbsentOrZeroProviderAmount(order.authorizedAmount) ||
  !isAbsentOrZeroProviderAmount(order.capturedAmount);

export const getProviderOrderAbandonmentCutoff = (
  providerOrderCreatedAt: Temporal.Instant
) =>
  providerOrderCreatedAt.add({
    minutes: providerOrderAbandonmentTimeoutMinutes,
  });

/**
 * When a payment attempt's local abandonment window ends. An attempt stored
 * without its provider order's creation time counts from its own creation,
 * which came first.
 */
export const getPaymentAttemptAbandonmentCutoff = (attempt: {
  readonly providerOrderCreatedAt: Temporal.Instant | null;
  readonly createdAt: Temporal.Instant;
}) =>
  getProviderOrderAbandonmentCutoff(
    attempt.providerOrderCreatedAt ?? attempt.createdAt
  );

type ProviderOrderAbandonmentInput = {
  readonly checkedAt: Temporal.Instant | undefined;
  readonly providerOrderCreatedAt: Temporal.Instant | null;
  readonly order: ProviderOrderState;
};

/** Like `getProviderOrderAbandonmentState`, with a deferral's cutoff. */
export const getProviderOrderAbandonment = (
  input: ProviderOrderAbandonmentInput
):
  | { readonly state: "abandoned" }
  | { readonly state: "deferred"; readonly cutoff: Temporal.Instant }
  | { readonly state: "not_empty" } => {
  if (
    hasProviderPaymentActivity(input.order) ||
    !input.checkedAt ||
    !input.providerOrderCreatedAt
  ) {
    return { state: "not_empty" };
  }

  const cutoff = getProviderOrderAbandonmentCutoff(
    input.providerOrderCreatedAt
  );
  return Temporal.Instant.compare(input.checkedAt, cutoff) < 0
    ? { state: "deferred", cutoff }
    : { state: "abandoned" };
};

export const getProviderOrderAbandonmentState = (
  input: ProviderOrderAbandonmentInput
): "abandoned" | "deferred" | "not_empty" =>
  getProviderOrderAbandonment(input).state;
