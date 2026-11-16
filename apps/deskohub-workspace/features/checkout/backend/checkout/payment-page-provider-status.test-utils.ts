import { mock } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type PaymentPageProviderObservation,
  PaymentPageProviderStatus,
} from "./payment-page-provider-status";

/**
 * The provider status of every payment page reads as `observation`;
 * `observe` records each lookup. `unknown` stands for a provider that can't
 * be asked, which leaves the provisional reopening window in charge.
 */
export const observePaymentPagesAs = (
  observation: PaymentPageProviderObservation
) => {
  const observe = mock(
    (_input: Parameters<PaymentPageProviderStatus["Service"]["observe"]>[0]) =>
      Effect.succeed(observation)
  );
  return {
    observe,
    layer: Layer.succeed(PaymentPageProviderStatus, { observe }),
  };
};
