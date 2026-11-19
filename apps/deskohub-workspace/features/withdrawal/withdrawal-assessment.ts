import { type Money, moneyShareRoundedUp } from "@/shared/money/money";

/** The unit a partial refund counts unused service in. */
export type WithdrawalRefundUnit = "day" | "hour";

/** How a withdrawal's refund relates to the amount paid. */
export type WithdrawalRefundBasis =
  | { readonly kind: "full" }
  | {
      readonly kind: "partial";
      readonly unit: WithdrawalRefundUnit;
      /** Units not yet started when the withdrawal was submitted. */
      readonly unstarted: number;
      /** Units the contract covers. */
      readonly total: number;
    };

/** Why a contract can't be withdrawn from at the assessed instant. */
export type WithdrawalRefusalReason =
  /** The contract isn't concluded and paid, or it already ended another way. */
  | "not_withdrawable"
  /** The customer contracted for a business purpose, not as a consumer. */
  | "business_purpose"
  /** The withdrawal period has ended. */
  | "period_ended"
  /** Every unit of service has started, so nothing is left to withdraw from. */
  | "performance_started";

/** A contract's withdrawal standing at one instant. */
export type WithdrawalAssessment =
  | {
      readonly withdrawable: true;
      readonly refundAmount: Money;
      readonly refundBasis: WithdrawalRefundBasis;
      readonly periodEndsAt: Temporal.Instant;
    }
  | {
      readonly withdrawable: false;
      readonly reason: WithdrawalRefusalReason;
    };

/**
 * The refund for a contract whose service is counted in `total` units, of
 * which `unstarted` hadn't started: the whole amount paid while none has
 * started, otherwise the unstarted share rounded up in the customer's favour.
 * A contract with no unstarted unit has nothing left to withdraw from, so it
 * has no refund here.
 */
export const getUnstartedServiceRefund = (input: {
  readonly paidAmount: Money;
  readonly unit: WithdrawalRefundUnit;
  readonly unstarted: number;
  readonly total: number;
}):
  | {
      readonly refundAmount: Money;
      readonly refundBasis: WithdrawalRefundBasis;
    }
  | undefined => {
  if (input.unstarted <= 0) return undefined;
  if (input.unstarted >= input.total) {
    return { refundAmount: input.paidAmount, refundBasis: { kind: "full" } };
  }
  return {
    refundAmount: moneyShareRoundedUp(
      input.paidAmount,
      input.unstarted,
      input.total
    ),
    refundBasis: {
      kind: "partial",
      unit: input.unit,
      unstarted: input.unstarted,
      total: input.total,
    },
  };
};
