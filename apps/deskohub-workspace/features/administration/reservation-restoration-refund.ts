import type { PaymentAttemptRow } from "@/db/schema";
import type { Money } from "@/shared/money/money";

export type RestorationRefundAttempt = Pick<
  PaymentAttemptRow,
  | "amountExponent"
  | "amountValue"
  | "currency"
  | "refundState"
  | "refundedAmountValue"
  | "state"
>;

/** What Nexi already refunded of a reservation an administrator restores. */
export type RestorationRefundedPayment = {
  /** The total Nexi refunded across the reservation's payment attempts. */
  readonly amount: Money;
  /** `full` when every paid attempt was refunded in full. */
  readonly coverage: "full" | "partial";
};

/**
 * The payment facts a restore acts on. A refund awaiting Nexi that never
 * happened is no longer owed once the reservation stands again, so restoring
 * clears it. A refund Nexi recorded stays as it is, and the administrator
 * acknowledges it before restoring. A recorded refund always carries its
 * amount and time (`payment_attempts_refund_record_check`).
 */
export const getRestorationRefund = (
  attempts: readonly RestorationRefundAttempt[]
): {
  /** Some attempt still awaits a refund that Nexi hasn't recorded. */
  readonly clearsRefundRequirement: boolean;
  readonly refundedPayment: RestorationRefundedPayment | null;
} => {
  const refunded = attempts.filter(
    (attempt) => attempt.refundState === "refunded"
  );
  const [first] = refunded;
  const clearsRefundRequirement = attempts.some(
    (attempt) => attempt.refundState === "required"
  );
  if (first === undefined) {
    return { clearsRefundRequirement, refundedPayment: null };
  }
  const paid = attempts.filter((attempt) => attempt.state === "paid");
  return {
    clearsRefundRequirement,
    refundedPayment: {
      amount: {
        value: refunded.reduce(
          (total, attempt) => total + (attempt.refundedAmountValue ?? 0),
          0
        ),
        exponent: first.amountExponent,
        currency: first.currency,
      },
      coverage: paid.every(
        (attempt) =>
          attempt.refundState === "refunded" &&
          (attempt.refundedAmountValue ?? 0) >= attempt.amountValue
      )
        ? "full"
        : "partial",
    },
  };
};
