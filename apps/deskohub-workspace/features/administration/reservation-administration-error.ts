import { Data } from "effect";
import type { RestorationRefundedPayment } from "./reservation-restoration-refund";

export type ReservationCancellationFailureReason =
  | "not_found"
  | "delivery_in_progress"
  | "confirmation_in_progress"
  | "invalid_state"
  | "cancelled_in_dotypos"
  | "pending_payment"
  | "changed"
  | "reservation_unavailable"
  | "details_unavailable"
  | "claim_failed"
  | "dotypos_failed"
  | "record_failed";

export type ReservationRestorationFailureReason =
  | "not_found"
  | "invalid_state"
  | "cancellation_in_progress"
  | "superseded"
  | "refund_acknowledgement_required"
  | "refund_check_failed"
  | "table_unavailable"
  | "changed_in_dotypos"
  | "dotypos_failed"
  | "access_uncertain"
  | "details_unavailable"
  | "record_failed";

export class ReservationAdministrationError extends Data.TaggedError(
  "ReservationAdministrationError"
)<{
  readonly code:
    | "not_found"
    | "not_cancellable"
    | "cancellation_failed"
    | "not_restorable"
    | "restoration_failed";
  /** Why the cancellation or restore stopped, so the Admin UI can explain it in the operator's language. */
  readonly reason:
    | ReservationCancellationFailureReason
    | ReservationRestorationFailureReason;
  /** What Nexi already refunded; set only when the restore stops with `refund_acknowledgement_required`. */
  readonly refundedPayment?: RestorationRefundedPayment;
  readonly message: string;
  readonly cause?: unknown;
}> {}
