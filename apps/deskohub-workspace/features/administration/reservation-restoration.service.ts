import {
  type DotyposReservationBooking,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { PaymentRefundService } from "@/features/checkout/backend/payment/payment-refund.service";
import { getRestorationBooking } from "@/features/checkout/backend/reservation/restoration-booking";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation/workspace-table-assignment.service";
import { baseLocale } from "@/features/i18n";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import {
  type ReservationRecord,
  toReservationRecord,
} from "@/features/reservation/backend/reservation-record";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  getDotyposReservationAccessTiming,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReservationAccessService } from "@/features/reservation-access";
import { getRestoredReservationAccess } from "@/features/reservation-access/reservation-access";
import { retractCancellationEvent } from "@/shared/backend/customer-events/customer-event-retraction";
import { formatMoney } from "@/shared/money/money";
import {
  ReservationAdministrationError,
  type ReservationRestorationFailureReason,
} from "./reservation-administration-error";
import {
  getRestorationRefund,
  type RestorationRefundAttempt,
  type RestorationRefundedPayment,
} from "./reservation-restoration-refund";
import { canRestoreReservation } from "./reservation-status";

export type ReservationRestorationInput = {
  readonly reservationId: WorkspaceReservationId;
  /** The administrator saw what Nexi already refunded and restores anyway. */
  readonly acknowledgeRefundedPayment: boolean;
  /** Tell the customer, when they were told about the cancellation. */
  readonly sendRestorationEmail: boolean;
};

export type ReservationRestorationResult = {
  /** `already_confirmed`: an earlier restore already finished; nothing was sent or issued again. */
  readonly outcome: "restored" | "already_confirmed";
  /** `not_available`: no cancellation email was recorded, so the customer isn't told about the restore either. */
  readonly email: "not_requested" | "sent" | "failed" | "not_available";
  /** `failed`: the restore stands, and the administration access retry issues the code. */
  readonly access: "issued" | "failed" | "not_needed";
};

interface IReservationRestorationService {
  /**
   * Confirms an administrator-cancelled reservation again: Dotypos first,
   * then the reservation, its awaited refunds and its cancellation event in
   * one transaction, then fresh door access and the customer's email.
   */
  readonly restore: (
    input: ReservationRestorationInput
  ) => Effect.Effect<
    ReservationRestorationResult,
    ReservationAdministrationError
  >;
}

/**
 * The restore's reservation write lost to a concurrent change of the
 * reservation, so its transaction rolled back.
 */
class RestorationRecordChanged extends Data.TaggedError(
  "RestorationRecordChanged"
)<{
  readonly reservationId: WorkspaceReservationId;
}> {}

const alreadyConfirmed: ReservationRestorationResult = {
  outcome: "already_confirmed",
  email: "not_requested",
  access: "not_needed",
};

export class ReservationRestorationService extends Context.Service<
  ReservationRestorationService,
  IReservationRestorationService
>()("@deskohub-workspace/administration/ReservationRestorationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const access = yield* ReservationAccessService;
      const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
      const { transaction } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const emails = yield* WorkspaceReservationEmailService;
      const refunds = yield* PaymentRefundService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;
      const tables = yield* WorkspaceTableAssignmentService;

      const loadReservation = Effect.fnUntraced(function* (
        id: WorkspaceReservationId
      ) {
        const reservation = yield* reservations
          .findById(id)
          .pipe(
            Effect.mapError((cause) =>
              restorationError("details_unavailable", cause)
            )
          );
        if (!reservation) return yield* restorationError("not_found");
        return reservation;
      });

      /**
       * The cancellation a restore undoes, or why the reservation can't be
       * restored as Workspace records it. Every fact is checked again under
       * the restore's locks.
       */
      const getRestorableCancellation = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation
      ) {
        if (reservation.reservationState === "cancelling") {
          return yield* restorationError("cancellation_in_progress");
        }
        if (reservation.reservationState !== "cancelled") {
          return yield* restorationError("invalid_state");
        }
        const successor = yield* reservations
          .findCurrentByCheckoutSessionKey(reservation.checkoutSessionKey)
          .pipe(
            Effect.mapError((cause) =>
              restorationError("details_unavailable", cause)
            )
          );
        const hasActiveSuccessor =
          successor !== null && successor.id !== reservation.id;
        const { dotyposReservationId, reservationCancelledAt } = reservation;
        if (
          !canRestoreReservation(reservation, { hasActiveSuccessor }) ||
          dotyposReservationId === null ||
          reservationCancelledAt === null
        ) {
          return yield* restorationError(
            hasActiveSuccessor ? "superseded" : "invalid_state"
          );
        }
        return {
          cancelledAt: reservationCancelledAt,
          dotyposReservationId,
        };
      });

      /** The reservation as Dotypos holds it now, read past every cache. */
      const readDotyposRecord = (dotyposReservationId: DotyposReservationId) =>
        dotypos.getReservationWithoutCustomer(dotyposReservationId).pipe(
          Effect.map(toReservationRecord),
          Effect.mapError((cause) =>
            restorationError(
              cause._tag === "DotyposRejected" && cause.reason === "not-found"
                ? "changed_in_dotypos"
                : "dotypos_failed",
              cause
            )
          )
        );

      const getBooking = (
        reservation: WorkspaceReservation,
        record: ReservationRecord
      ) =>
        getRestorationBooking({ reservation, record }).pipe(
          Effect.provideService(
            AccountingDocumentSnapshotRepository,
            accountingSnapshots
          ),
          Effect.mapError((cause) =>
            restorationError(
              cause._tag === "RestorationBookingChanged"
                ? "changed_in_dotypos"
                : "details_unavailable",
              cause
            )
          )
        );

      /** The span the restored reservation holds, early setup included, which its door code covers. */
      const getHeldSpan = (
        reservation: WorkspaceReservation,
        record: ReservationRecord
      ) =>
        getDotyposReservationAccessTiming({
          reservationId: reservation.id,
          reservation: decodeBookedReservation(
            record,
            reservation.reservationDetails
          ),
        }).pipe(
          Effect.mapError((cause) =>
            restorationError("details_unavailable", cause)
          )
        );

      /**
       * A confirmed reservation whose cancellation a restore undid, which
       * Dotypos still holds confirmed with its booking: the restore already
       * finished, so a retry reports it without acting again.
       */
      const settleRestoredReservation = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation
      ) {
        const wasCancelled = yield* reservations
          .hasRecordedCancellation(reservation.id)
          .pipe(
            Effect.mapError((cause) =>
              restorationError("details_unavailable", cause)
            )
          );
        if (!wasCancelled || reservation.dotyposReservationId === null) {
          return yield* restorationError("invalid_state");
        }
        const record = yield* readDotyposRecord(
          reservation.dotyposReservationId
        );
        if (record.status !== "CONFIRMED") {
          return yield* restorationError("changed_in_dotypos");
        }
        yield* getBooking(reservation, record);
        return alreadyConfirmed;
      });

      const restoreInDotypos = (input: {
        readonly dotyposReservationId: DotyposReservationId;
        readonly expectedBooking: DotyposReservationBooking;
      }) =>
        dotypos
          .restoreCancelledReservation({
            reservationId: input.dotyposReservationId,
            expectedBooking: input.expectedBooking,
          })
          .pipe(
            Effect.asVoid,
            Effect.mapError((cause) =>
              restorationError(
                cause._tag === "DotyposReservationNotRestorable" ||
                  (cause._tag === "DotyposRejected" &&
                    cause.reason === "not-found")
                  ? "changed_in_dotypos"
                  : "dotypos_failed",
                cause
              )
            )
          );

      /**
       * Records the restore in one transaction, after Dotypos confirmed the
       * reservation again: locks and plans its access grant, confirms the
       * reservation while it is still the cancellation the restore read,
       * checks the refunds Nexi recorded since, and retracts the
       * cancellation's event. Returns the access plan it committed.
       */
      const recordRestoration = (input: {
        readonly reservationId: WorkspaceReservationId;
        readonly cancelledAt: Temporal.Instant;
        readonly reservedFrom: Temporal.Instant;
        readonly reservedUntil: Temporal.Instant;
        readonly acknowledgeRefundedPayment: boolean;
        readonly now: Temporal.Instant;
      }) =>
        transaction(
          Effect.gen(function* () {
            const plan = yield* access
              .prepareRestoredAccess({
                reservationId: input.reservationId,
                reservedFrom: input.reservedFrom,
                reservedUntil: input.reservedUntil,
                now: input.now,
              })
              .pipe(
                Effect.mapError((cause) =>
                  restorationError("record_failed", cause)
                )
              );
            if (plan === "uncertain") {
              return yield* restorationError("access_uncertain");
            }
            const restored = yield* reservations
              .markAdministrationRestored({
                id: input.reservationId,
                cancelledAt: input.cancelledAt,
                restoredAt: input.now,
              })
              .pipe(
                Effect.catchTags({
                  EffectDrizzleQueryError: (cause) =>
                    Effect.fail(restorationError("record_failed", cause)),
                  WorkspaceReservationDetailsMalformedError: (cause) =>
                    Effect.fail(restorationError("record_failed", cause)),
                })
              );
            if (!restored) {
              return yield* new RestorationRecordChanged({
                reservationId: input.reservationId,
              });
            }
            yield* requireRefundAcknowledgement(
              restored.paymentAttempts,
              input.acknowledgeRefundedPayment
            );
            yield* retractCancellationEvent({
              reservationId: input.reservationId,
              cancelledAt: input.cancelledAt,
              at: input.now,
            }).pipe(
              // The planner withdraws the cancellation's automation runs;
              // the restore only records how the event stood.
              Effect.tap((retraction) =>
                Effect.logInfo(
                  "The restore settled the cancellation event."
                ).pipe(Effect.annotateLogs({ retraction }))
              ),
              Effect.mapError((cause) =>
                restorationError("record_failed", cause)
              )
            );
            return plan;
          })
        ).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: (cause) =>
              Effect.fail(restorationError("record_failed", cause)),
            SqlError: (cause) =>
              Effect.fail(restorationError("record_failed", cause)),
          })
        );

      /**
       * Another reservation took the checkout session after the restore
       * confirmed this one in Dotypos: cancels it there again, so Dotypos
       * holds only the session's active reservation, and refuses.
       */
      const withdrawSupersededRestore = Effect.fnUntraced(function* (
        dotyposReservationId: DotyposReservationId,
        cause: unknown
      ) {
        yield* dotypos
          .cancelReservation(dotyposReservationId)
          .pipe(
            Effect.catch((cancelCause) =>
              Effect.logError(
                "A superseded restore left its reservation confirmed in Dotypos while Workspace keeps it cancelled; an operator must cancel it in Dotypos.",
                cancelCause
              )
            )
          );
        return yield* restorationError("superseded", cause);
      });

      /**
       * The restore's reservation write found the reservation changed since
       * it was read: an earlier restore finished it, or it is refused as it
       * now stands.
       */
      const settleChangedReservation = Effect.fnUntraced(function* (
        reservationId: WorkspaceReservationId
      ) {
        const latest = yield* loadReservation(reservationId);
        if (latest.reservationState === "confirmed") return alreadyConfirmed;
        yield* getRestorableCancellation(latest);
        return yield* restorationError("invalid_state");
      });

      const sendRestorationEmail = (input: {
        readonly reservation: WorkspaceReservation;
        readonly send: boolean;
        readonly accessReissued: boolean;
      }) => {
        if (!input.send) return Effect.succeed("not_requested" as const);
        if (input.reservation.cancellationEmailSentAt === null) {
          return Effect.succeed("not_available" as const);
        }
        return reservationDetails.getReservation(input.reservation.id).pipe(
          Effect.flatMap((reservation) =>
            emails.sendRestorationEmail({
              reservation,
              accessReissued: input.accessReissued,
            })
          ),
          Effect.as("sent" as const),
          Effect.catch((cause) =>
            Effect.logWarning(
              "The restoration email could not be sent.",
              cause
            ).pipe(Effect.as("failed" as const))
          )
        );
      };

      return {
        restore: Effect.fn("ReservationRestorationService.restore")(
          function* (input) {
            const now = Temporal.Now.instant();
            const reservation = yield* loadReservation(input.reservationId);
            if (reservation.reservationState === "confirmed") {
              return yield* settleRestoredReservation(reservation);
            }
            const { cancelledAt, dotyposReservationId } =
              yield* getRestorableCancellation(reservation);

            const record = yield* readDotyposRecord(dotyposReservationId);
            if (record.status === "NEW") {
              return yield* restorationError("changed_in_dotypos");
            }
            const expectedBooking = yield* getBooking(reservation, record);
            const span = yield* getHeldSpan(reservation, record);

            const grant = yield* access
              .loadGrant(reservation.id)
              .pipe(
                Effect.mapError((cause) =>
                  restorationError("details_unavailable", cause)
                )
              );
            const accessPlan = getRestoredReservationAccess(grant, span, now);
            if (accessPlan === "uncertain") {
              return yield* restorationError("access_uncertain");
            }

            const attempts = yield* refunds
              .reconcileReservationRefunds(reservation.id)
              .pipe(
                Effect.mapError((cause) =>
                  restorationError("refund_check_failed", cause)
                )
              );
            yield* requireRefundAcknowledgement(
              attempts,
              input.acknowledgeRefundedPayment
            );

            // An ended reservation holds nothing anyone could book.
            if (accessPlan !== "not_needed") {
              const availability = yield* tables
                .getAssignedTableAvailability({
                  reservation: record,
                  kind: reservation.reservationDetails.kind,
                })
                .pipe(
                  Effect.mapError((cause) =>
                    restorationError("dotypos_failed", cause)
                  )
                );
              if (availability === "unavailable") {
                return yield* restorationError("table_unavailable");
              }
            }

            yield* restoreInDotypos({ dotyposReservationId, expectedBooking });

            const committedPlan = yield* recordRestoration({
              reservationId: reservation.id,
              cancelledAt,
              reservedFrom: span.reservedFrom,
              reservedUntil: span.reservedUntil,
              acknowledgeRefundedPayment: input.acknowledgeRefundedPayment,
              now,
            }).pipe(
              Effect.catchTags({
                WorkspaceReservationSessionTakenError: (cause) =>
                  withdrawSupersededRestore(dotyposReservationId, cause),
                RestorationRecordChanged: () =>
                  settleChangedReservation(reservation.id),
              })
            );
            if (committedPlan === alreadyConfirmed) return alreadyConfirmed;

            const accessOutcome =
              committedPlan === "issue"
                ? yield* access.issueRestoredAccess({
                    reservationId: reservation.id,
                    reservedFrom: span.reservedFrom,
                    reservedUntil: span.reservedUntil,
                  })
                : ("not_needed" as const);

            return {
              outcome: "restored",
              email: yield* sendRestorationEmail({
                reservation,
                send: input.sendRestorationEmail,
                accessReissued: accessOutcome === "issued",
              }),
              access: accessOutcome,
            } satisfies ReservationRestorationResult;
          }
        ),
      } satisfies IReservationRestorationService;
    })
  );
}

const restorationErrorCodes = {
  not_found: "not_found",
  invalid_state: "not_restorable",
  cancellation_in_progress: "not_restorable",
  superseded: "not_restorable",
  refund_acknowledgement_required: "not_restorable",
  table_unavailable: "not_restorable",
  changed_in_dotypos: "not_restorable",
  access_uncertain: "not_restorable",
  refund_check_failed: "restoration_failed",
  dotypos_failed: "restoration_failed",
  details_unavailable: "restoration_failed",
  record_failed: "restoration_failed",
} as const satisfies Record<
  ReservationRestorationFailureReason,
  ReservationAdministrationError["code"]
>;

type RestorationRefusalReason = Exclude<
  ReservationRestorationFailureReason,
  "refund_acknowledgement_required"
>;

const restorationErrorMessages = {
  not_found: "The reservation was not found.",
  invalid_state: "The reservation cannot be restored in its current state.",
  cancellation_in_progress:
    "The reservation is still being cancelled. Try again after the cancellation finishes.",
  superseded:
    "Another reservation of the same checkout replaced this one, so it cannot be restored.",
  table_unavailable:
    "The reservation's table is no longer free for its time, so it cannot be restored.",
  changed_in_dotypos:
    "Dotypos no longer holds the cancelled booking, so the reservation cannot be restored.",
  access_uncertain:
    "The reservation's door access must be reconciled before it can be restored.",
  refund_check_failed: "The reservation's refunds could not be checked.",
  dotypos_failed: "Dotypos could not restore the reservation.",
  details_unavailable: "The reservation details could not be loaded.",
  record_failed: "The restored reservation could not be recorded.",
} satisfies Record<RestorationRefusalReason, string>;

const restorationError = (reason: RestorationRefusalReason, cause?: unknown) =>
  new ReservationAdministrationError({
    code: restorationErrorCodes[reason],
    reason,
    message: restorationErrorMessages[reason],
    ...(cause !== undefined && { cause }),
  });

/** Refuses a restore of a payment Nexi refunded, until the administrator acknowledges the refund. */
const requireRefundAcknowledgement = (
  attempts: readonly RestorationRefundAttempt[],
  acknowledgeRefundedPayment: boolean
) => {
  const { refundedPayment } = getRestorationRefund(attempts);
  if (refundedPayment === null || acknowledgeRefundedPayment) {
    return Effect.void;
  }
  return Effect.fail(refundAcknowledgementRequired(refundedPayment));
};

const refundAcknowledgementRequired = (
  refundedPayment: RestorationRefundedPayment
) =>
  new ReservationAdministrationError({
    code: restorationErrorCodes.refund_acknowledgement_required,
    reason: "refund_acknowledgement_required",
    refundedPayment,
    message: `Nexi already refunded ${formatMoney(refundedPayment.amount, baseLocale)} of this reservation (${refundedPayment.coverage} refund). Acknowledge the refunded payment to restore it.`,
  });
