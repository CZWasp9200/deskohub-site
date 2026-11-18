import type { Locale } from "@/features/i18n";
import { formatMoney } from "@/shared/money/money";
import { m } from "./i18n";
import type { ReservationAccessAdministrationError } from "./reservation-access-administration.service";
import type {
  ReservationAdministrationError,
  ReservationCancellationFailureReason,
  ReservationRestorationFailureReason,
} from "./reservation-administration-error";
import type { RestorationRefundedPayment } from "./reservation-restoration-refund";

type AdministrationMessage =
  typeof m.administrationReservationCancellationErrorNotFound;

const cancellationErrorMessages = {
  not_found: m.administrationReservationCancellationErrorNotFound,
  delivery_in_progress:
    m.administrationReservationCancellationErrorDeliveryInProgress,
  confirmation_in_progress:
    m.administrationReservationCancellationErrorConfirmationInProgress,
  invalid_state: m.administrationReservationCancellationErrorInvalidState,
  cancelled_in_dotypos:
    m.administrationReservationCancellationErrorCancelledInDotypos,
  pending_payment: m.administrationReservationCancellationErrorPendingPayment,
  changed: m.administrationReservationCancellationErrorChanged,
  reservation_unavailable:
    m.administrationReservationCancellationErrorReservationUnavailable,
  details_unavailable:
    m.administrationReservationCancellationErrorDetailsUnavailable,
  claim_failed: m.administrationReservationCancellationErrorClaimFailed,
  dotypos_failed: m.administrationReservationCancellationErrorDotyposFailed,
  record_failed: m.administrationReservationCancellationErrorRecordFailed,
  invoice_unavailable:
    m.administrationReservationCancellationErrorInvoiceUnavailable,
  confirmation_stale:
    m.administrationReservationCancellationErrorConfirmationStale,
} satisfies Record<ReservationCancellationFailureReason, AdministrationMessage>;

const isCancellationFailureReason = (
  reason: ReservationAdministrationError["reason"]
): reason is ReservationCancellationFailureReason =>
  Object.hasOwn(cancellationErrorMessages, reason);

/**
 * The operator-facing reason a reservation cancellation stopped. A
 * cancellation never stops for a restore's reason; one reads as an invalid
 * state.
 */
export const getReservationCancellationErrorMessage = (
  reason: ReservationAdministrationError["reason"],
  locale: Locale
) =>
  cancellationErrorMessages[
    isCancellationFailureReason(reason) ? reason : "invalid_state"
  ]({}, { locale });

/** The operator-facing reason door access recovery stopped. */
export const getReservationAccessErrorMessage = (
  reason: ReservationAccessAdministrationError["reason"],
  locale: Locale
) =>
  ({
    not_found: m.administrationReservationAccessErrorNotFound,
    invalid_state: m.administrationReservationAccessErrorInvalidState,
    retryable_failure:
      m.administrationReservationAccessErrorTemporarilyUnavailable,
    recovery_failed: m.administrationReservationAccessErrorRecoveryFailed,
  })[reason]({}, { locale });

const restorationErrorMessages = {
  not_found: m.administrationReservationRestorationErrorNotFound,
  invalid_state: m.administrationReservationRestorationErrorInvalidState,
  cancellation_in_progress:
    m.administrationReservationRestorationErrorCancellationInProgress,
  superseded: m.administrationReservationRestorationErrorSuperseded,
  refund_acknowledgement_required:
    m.administrationReservationRestorationErrorRefundAcknowledgementRequired,
  refund_check_failed:
    m.administrationReservationRestorationErrorRefundCheckFailed,
  table_unavailable:
    m.administrationReservationRestorationErrorTableUnavailable,
  changed_in_dotypos:
    m.administrationReservationRestorationErrorChangedInDotypos,
  dotypos_failed: m.administrationReservationRestorationErrorDotyposFailed,
  access_uncertain: m.administrationReservationRestorationErrorAccessUncertain,
  details_unavailable:
    m.administrationReservationRestorationErrorDetailsUnavailable,
  record_failed: m.administrationReservationRestorationErrorRecordFailed,
} satisfies Record<ReservationRestorationFailureReason, AdministrationMessage>;

const isRestorationFailureReason = (
  reason: ReservationAdministrationError["reason"]
): reason is ReservationRestorationFailureReason =>
  Object.hasOwn(restorationErrorMessages, reason);

/**
 * The operator-facing reason a reservation restoration stopped. A refusal to
 * restore over a refund names the refunded amount when the service reports it.
 * A restore never stops for a cancellation's reason; one reads as an invalid
 * state.
 */
export const getReservationRestorationErrorMessage = (
  reason: ReservationAdministrationError["reason"],
  locale: Locale,
  refundedPayment?: RestorationRefundedPayment
) =>
  reason === "refund_acknowledgement_required" && refundedPayment
    ? {
        full: m.administrationReservationRestorationErrorRefundedFull,
        partial: m.administrationReservationRestorationErrorRefundedPartial,
      }[refundedPayment.coverage](
        { amount: formatMoney(refundedPayment.amount, locale) },
        { locale }
      )
    : restorationErrorMessages[
        isRestorationFailureReason(reason) ? reason : "invalid_state"
      ]({}, { locale });
