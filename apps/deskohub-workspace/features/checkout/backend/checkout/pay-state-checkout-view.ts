import type {
  CheckoutSummary,
  CheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type {
  CanonicalPromotionCode,
  DiscountId,
} from "@/features/discounts/contracts";
import {
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "@/features/legal/early-performance";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type Instant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { PayState, type PayStateWithHoldExpiry } from "./pay-state";

/**
 * What a client shows for one signed Pay state: the order, its summary, a
 * pending price review, and whether submitting it needs the early-performance
 * request. The Pay page computes the same facts from the same state.
 */
export type PayStateCheckoutView = {
  readonly orderId: WorkspaceReservationId;
  /** The instant the Pay state token stops being accepted. */
  readonly expiresAt: string;
  /** The instant the reservation hold ends; reissuing the token keeps it. */
  readonly holdExpiresAt: Instant;
  readonly summary: CheckoutSummary;
  /** The entered code the price includes, with its summary discount's id. */
  readonly appliedDiscountCode?: {
    readonly code: CanonicalPromotionCode;
    readonly discountId: DiscountId;
  };
  /** Set while the customer still has to accept a price change. */
  readonly changedKeys: CheckoutSummaryChangedKeys | undefined;
  readonly earlyPerformanceConsent: {
    readonly required: boolean;
    /** From this instant on, submitting needs the early-performance request. */
    readonly requiredFrom: string;
  };
};

export const getPayStateCheckoutView = (
  state: PayStateWithHoldExpiry,
  now: Temporal.Instant
): PayStateCheckoutView => ({
  orderId: state.orderId,
  expiresAt: PayState.expiresAt(state),
  holdExpiresAt: state.holdExpiresAt,
  summary: PayState.summary(state),
  ...(state.submittedCode !== undefined && {
    appliedDiscountCode: {
      code: state.submittedCode,
      discountId: state.submittedCodeDiscountId,
    },
  }),
  changedKeys: state.changedKeys,
  earlyPerformanceConsent: {
    required: isEarlyPerformanceRequestRequired({
      reservation: state.reservation,
      contractAt: now,
    }),
    requiredFrom: temporalInstantToIsoString(
      getEarlyPerformanceRequestRequiredAt(state.reservation)
    ),
  },
});
