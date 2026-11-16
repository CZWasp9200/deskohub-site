import { Effect, Layer } from "effect";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import type { CheckoutUnavailableError } from "./checkout-unavailable";
import { PayState, type SignedPayState } from "./pay-state";
import { withPayStateHoldExpiry } from "./pay-state-hold";
import {
  PayableCheckout,
  type PayableCheckoutReadError,
  type PayableReservation,
} from "./payable-checkout.service";

/**
 * A `PayableCheckout` that opens real Pay-state tokens with the test key ring
 * and answers payability with `confirm`: the reservation it returns is
 * payable, and its failure is the checkout's. Each `open` and `reconfirm`
 * calls `confirm` once.
 */
export const PayableCheckoutMock = (
  confirm: (
    state: SignedPayState
  ) => Effect.Effect<
    PayableReservation,
    CheckoutUnavailableError | PayableCheckoutReadError
  >
) =>
  Layer.effect(
    PayableCheckout,
    Effect.gen(function* () {
      const provideSealedStateKeys = Effect.provideService(
        SealedStateKeys,
        yield* SealedStateKeys
      );
      const reconfirm = (state: SignedPayState) =>
        confirm(state).pipe(
          Effect.map((reservation) => ({
            state: withPayStateHoldExpiry(state, reservation),
            reservation,
          }))
        );
      return PayableCheckout.of({
        open: ({ payStateToken, page }) =>
          PayState.open(payStateToken, page).pipe(
            provideSealedStateKeys,
            Effect.flatMap(reconfirm)
          ),
        reconfirm,
      });
    })
  );
