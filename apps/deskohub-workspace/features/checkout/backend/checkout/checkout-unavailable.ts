import { Data, Schema } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { SignedPayState } from "./pay-state";

const checkoutUnavailableReasonSchema = Schema.Literals([
  "missing_checkout_session",
  "missing_reservation",
  "not_current",
  "retried_attempt_replaced",
  "payment_ended",
  "not_held",
  "expired",
  "missing_dotypos_reservation",
  "dotypos_not_pending",
]).annotate({
  identifier: "CheckoutUnavailableReason",
  description: "Why a Pay state's order can't be paid now.",
});

export type CheckoutUnavailableReason =
  typeof checkoutUnavailableReasonSchema.Type;

/**
 * A Pay state's order can't be paid now. `restartKind` is the reservation
 * kind a customer starts again with; `paidOrderId` is set when the order is
 * already paid, so a resubmitted Pay state can lead to it.
 */
export class CheckoutUnavailableError extends Data.TaggedError(
  "CheckoutUnavailableError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly reason: CheckoutUnavailableReason;
  readonly restartKind: SignedPayState["reservation"]["kind"];
  readonly paidOrderId?: WorkspaceReservationId;
}> {}
