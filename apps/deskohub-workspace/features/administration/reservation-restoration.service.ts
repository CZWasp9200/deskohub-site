import {
  type DotyposReservation,
  type DotyposReservationBooking,
  type DotyposReservationId,
  DotyposService,
  type RestoreCancelledReservationResult,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match, Option, Predicate } from "effect";
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
import {
  getRestoredReservationAccess,
  type RestoredReservationAccess,
} from "@/features/reservation-access/reservation-access";
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

/** The cancellation a restore undoes. */
type RestorableCancellation = {
  readonly cancelledAt: Temporal.Instant;
  readonly dotyposReservationId: DotyposReservationId;
};

/** The span the restored reservation holds, early setup included, which its door code covers. */
type HeldSpan = {
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
};

/** Door access a restore can go ahead with. */
type RestorableAccess = Exclude<RestoredReservationAccess, "uncertain">;

const isRestorableAccess = (
  plan: RestoredReservationAccess
): plan is RestorableAccess => plan !== "uncertain";

/**
 * How the restore's write ended: it recorded the restore with the access
 * plan it committed, or found that an earlier restore already finished.
 */
type RestorationRecording = Data.TaggedEnum<{
  Recorded: { readonly accessPlan: RestorableAccess };
  AlreadyRestored: Record<never, never>;
}>;

const RestorationRecording = Data.taggedEnum<RestorationRecording>();

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

      const loadReservation = (id: WorkspaceReservationId) =>
        reservations.findById(id).pipe(
          Effect.mapError((cause) =>
            restorationError("details_unavailable", cause)
          ),
          Effect.filterOrFail(Predicate.isNotNull, () =>
            restorationError("not_found")
          )
        );

      /**
       * The cancellation a restore undoes, or why the reservation can't be
       * restored as Workspace records it. Every fact is checked again under
       * the restore's locks.
       */
      const getRestorableCancellation = Effect.fnUntraced(function* ({
        reservation,
      }: {
        readonly reservation: WorkspaceReservation;
      }) {
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
        } satisfies RestorableCancellation;
      });

      /**
       * The Dotypos reservation of a confirmed reservation whose
       * cancellation a restore undid, or invalid_state for one that was
       * never cancelled.
       */
      const getUndoneCancellation = Effect.fnUntraced(function* ({
        reservation,
      }: {
        readonly reservation: WorkspaceReservation;
      }) {
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
        return reservation.dotyposReservationId;
      });

      /** The reservation as Dotypos holds it now, read past every cache. */
      const readDotyposReservation = (
        dotyposReservationId: DotyposReservationId
      ) =>
        dotypos
          .getReservationWithoutCustomer(dotyposReservationId)
          .pipe(
            Effect.mapError((cause) =>
              restorationError(
                cause._tag === "DotyposRejected" && cause.reason === "not-found"
                  ? "changed_in_dotypos"
                  : "dotypos_failed",
                cause
              )
            )
          );

      const getBooking = ({
        reservation,
        record,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly record: ReservationRecord;
      }) =>
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

      const getHeldSpan = ({
        reservation,
        record,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly record: ReservationRecord;
      }) =>
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
       * Dotypos still holds confirmed with its booking, customer included:
       * the restore already finished, so a retry reports it without acting
       * again.
       */
      const settleRestoredReservation = (input: {
        readonly reservation: WorkspaceReservation;
      }) =>
        Effect.succeed(input).pipe(
          Effect.bind("dotyposReservationId", getUndoneCancellation),
          Effect.bind("dotyposReservation", ({ dotyposReservationId }) =>
            readDotyposReservation(dotyposReservationId)
          ),
          Effect.filterOrFail(
            ({ dotyposReservation }) =>
              dotyposReservation.status === "CONFIRMED",
            () => restorationError("changed_in_dotypos")
          ),
          Effect.let("record", ({ dotyposReservation }) =>
            toReservationRecord(dotyposReservation)
          ),
          Effect.bind("booking", getBooking),
          Effect.filterOrFail(
            ({ dotyposReservation, booking }) =>
              booksCustomer(dotyposReservation, booking),
            () => restorationError("changed_in_dotypos")
          ),
          Effect.as(alreadyConfirmed)
        );

      const planRestoredAccess = ({
        reservation,
        span,
        now,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly span: HeldSpan;
        readonly now: Temporal.Instant;
      }) =>
        access.loadGrant(reservation.id).pipe(
          Effect.mapError((cause) =>
            restorationError("details_unavailable", cause)
          ),
          Effect.map((grant) => getRestoredReservationAccess(grant, span, now)),
          Effect.filterOrFail(isRestorableAccess, () =>
            restorationError("access_uncertain")
          )
        );

      const checkRefunds = ({
        reservation,
        acknowledgeRefundedPayment,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly acknowledgeRefundedPayment: boolean;
      }) =>
        refunds.reconcileReservationRefunds(reservation.id).pipe(
          Effect.mapError((cause) =>
            restorationError("refund_check_failed", cause)
          ),
          Effect.flatMap((attempts) =>
            requireRefundAcknowledgement({
              attempts,
              acknowledgeRefundedPayment,
            })
          )
        );

      /** Refuses a restore whose table someone else booked since. */
      const requireTableAvailable = ({
        reservation,
        record,
        accessPlan,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly record: ReservationRecord;
        readonly accessPlan: RestorableAccess;
      }) =>
        Match.value(accessPlan).pipe(
          // An ended reservation holds nothing anyone could book.
          Match.when("not_needed", () => Effect.void),
          Match.when("issue", () =>
            tables
              .getAssignedTableAvailability({
                reservation: record,
                kind: reservation.reservationDetails.kind,
              })
              .pipe(
                Effect.mapError((cause) =>
                  restorationError("dotypos_failed", cause)
                ),
                Effect.filterOrFail(
                  (availability) => availability !== "unavailable",
                  () => restorationError("table_unavailable")
                ),
                Effect.asVoid
              )
          ),
          Match.exhaustive
        );

      const restoreInDotypos = ({
        cancellation,
        expectedBooking,
      }: {
        readonly cancellation: RestorableCancellation;
        readonly expectedBooking: DotyposReservationBooking;
      }) =>
        dotypos
          .restoreCancelledReservation({
            reservationId: cancellation.dotyposReservationId,
            expectedBooking,
          })
          .pipe(
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

      const prepareAccess = (input: {
        readonly reservationId: WorkspaceReservationId;
        readonly reservedFrom: Temporal.Instant;
        readonly reservedUntil: Temporal.Instant;
        readonly now: Temporal.Instant;
      }) =>
        access.prepareRestoredAccess(input).pipe(
          Effect.mapError((cause) => restorationError("record_failed", cause)),
          Effect.filterOrFail(isRestorableAccess, () =>
            restorationError("access_uncertain")
          )
        );

      /** Confirms the reservation while it is still the cancellation the restore read. */
      const confirmReservation = ({
        reservationId,
        cancelledAt,
        now,
      }: {
        readonly reservationId: WorkspaceReservationId;
        readonly cancelledAt: Temporal.Instant;
        readonly now: Temporal.Instant;
      }) =>
        reservations
          .markAdministrationRestored({
            id: reservationId,
            cancelledAt,
            restoredAt: now,
          })
          .pipe(
            Effect.catchTags({
              EffectDrizzleQueryError: (cause) =>
                Effect.fail(restorationError("record_failed", cause)),
              WorkspaceReservationDetailsMalformedError: (cause) =>
                Effect.fail(restorationError("record_failed", cause)),
            }),
            Effect.filterOrFail(
              Predicate.isNotNull,
              () => new RestorationRecordChanged({ reservationId })
            )
          );

      const retractCancellation = ({
        reservationId,
        cancelledAt,
        now,
      }: {
        readonly reservationId: WorkspaceReservationId;
        readonly cancelledAt: Temporal.Instant;
        readonly now: Temporal.Instant;
      }) =>
        retractCancellationEvent({ reservationId, cancelledAt, at: now }).pipe(
          // The planner withdraws the cancellation's automation runs;
          // the restore only records how the event stood.
          Effect.tap((retraction) =>
            Effect.logInfo("The restore settled the cancellation event.").pipe(
              Effect.annotateLogs({ retraction })
            )
          ),
          Effect.mapError((cause) => restorationError("record_failed", cause))
        );

      /**
       * Records the restore in one transaction, after Dotypos confirmed the
       * reservation again: locks and plans its access grant, confirms the
       * reservation, checks the refunds Nexi recorded since, and retracts
       * the cancellation's event.
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
          Effect.succeed(input).pipe(
            Effect.bind("accessPlan", prepareAccess),
            Effect.bind("restored", confirmReservation),
            Effect.tap(({ restored, acknowledgeRefundedPayment }) =>
              requireRefundAcknowledgement({
                attempts: restored.paymentAttempts,
                acknowledgeRefundedPayment,
              })
            ),
            Effect.tap(retractCancellation),
            Effect.map(({ accessPlan }) =>
              RestorationRecording.Recorded({ accessPlan })
            )
          )
        ).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: (cause) =>
              Effect.fail(restorationError("record_failed", cause)),
            SqlError: (cause) =>
              Effect.fail(restorationError("record_failed", cause)),
          })
        );

      /**
       * Another reservation took the checkout session after Dotypos
       * confirmed this one again. When this restore made that write, it
       * cancels the reservation there again, so Dotypos holds only the
       * session's active reservation; a confirmation it found already made
       * is left for an operator. Either way the restore is refused.
       */
      const refuseSupersededRestore = (input: {
        readonly dotyposRestore: RestoreCancelledReservationResult;
        readonly dotyposReservationId: DotyposReservationId;
        readonly cause: unknown;
      }) =>
        Match.valueTags(input.dotyposRestore, {
          Restored: () =>
            dotypos
              .cancelReservation(input.dotyposReservationId)
              .pipe(
                Effect.catch((cancelCause) =>
                  Effect.logError(
                    "A superseded restore left its reservation confirmed in Dotypos while Workspace keeps it cancelled; an operator must cancel it in Dotypos.",
                    cancelCause
                  )
                )
              ),
          AlreadyConfirmed: () =>
            Effect.logError(
              "Workspace keeps a superseded reservation cancelled while Dotypos holds it CONFIRMED; an operator must reconcile it in Dotypos."
            ),
        }).pipe(
          Effect.annotateLogs({
            dotyposReservationId: input.dotyposReservationId,
          }),
          Effect.andThen(
            Effect.fail(restorationError("superseded", input.cause))
          )
        );

      /**
       * The restore's reservation write found the reservation changed since
       * it was read: an earlier restore finished it, or it is refused as it
       * now stands.
       */
      const settleChangedReservation = (
        reservationId: WorkspaceReservationId
      ) =>
        loadReservation(reservationId).pipe(
          Effect.flatMap((reservation) =>
            Match.value(reservation.reservationState).pipe(
              Match.when("confirmed", () =>
                Effect.succeed(RestorationRecording.AlreadyRestored())
              ),
              Match.orElse(() =>
                getRestorableCancellation({ reservation }).pipe(
                  Effect.andThen(Effect.fail(restorationError("invalid_state")))
                )
              )
            )
          )
        );

      const finalizeRestoration = ({
        reservation,
        cancellation,
        span,
        acknowledgeRefundedPayment,
        now,
        dotyposRestore,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly cancellation: RestorableCancellation;
        readonly span: HeldSpan;
        readonly acknowledgeRefundedPayment: boolean;
        readonly now: Temporal.Instant;
        readonly dotyposRestore: RestoreCancelledReservationResult;
      }) =>
        recordRestoration({
          reservationId: reservation.id,
          cancelledAt: cancellation.cancelledAt,
          reservedFrom: span.reservedFrom,
          reservedUntil: span.reservedUntil,
          acknowledgeRefundedPayment,
          now,
        }).pipe(
          Effect.catchTags({
            WorkspaceReservationSessionTakenError: (cause) =>
              refuseSupersededRestore({
                dotyposRestore,
                dotyposReservationId: cancellation.dotyposReservationId,
                cause,
              }),
            RestorationRecordChanged: () =>
              settleChangedReservation(reservation.id),
          })
        );

      const issueAccess = ({
        reservation,
        span,
        accessPlan,
      }: {
        readonly reservation: WorkspaceReservation;
        readonly span: HeldSpan;
        readonly accessPlan: RestorableAccess;
      }) =>
        Match.value(accessPlan).pipe(
          Match.when("issue", () =>
            access.issueRestoredAccess({
              reservationId: reservation.id,
              reservedFrom: span.reservedFrom,
              reservedUntil: span.reservedUntil,
            })
          ),
          Match.when("not_needed", () => Effect.succeed("not_needed" as const)),
          Match.exhaustive
        );

      const sendRestorationEmail = (input: {
        readonly reservation: WorkspaceReservation;
        readonly send: boolean;
        readonly accessReissued: boolean;
      }) =>
        Match.value(input).pipe(
          Match.when({ send: false }, () =>
            Effect.succeed("not_requested" as const)
          ),
          Match.when(
            ({ reservation }) => reservation.cancellationEmailSentAt === null,
            () => Effect.succeed("not_available" as const)
          ),
          Match.orElse(({ reservation, accessReissued }) =>
            reservationDetails.getReservation(reservation.id).pipe(
              Effect.flatMap((details) =>
                emails.sendRestorationEmail({
                  reservation: details,
                  accessReissued,
                })
              ),
              Effect.as("sent" as const),
              Effect.catch((cause) =>
                Effect.logWarning(
                  "The restoration email could not be sent.",
                  cause
                ).pipe(Effect.as("failed" as const))
              )
            )
          )
        );

      /** Issues the restored reservation's access and tells its customer, once the restore is recorded. */
      const completeRestoration = (input: {
        readonly reservation: WorkspaceReservation;
        readonly span: HeldSpan;
        readonly accessPlan: RestorableAccess;
        readonly sendRestorationEmail: boolean;
      }) =>
        Effect.succeed(input).pipe(
          Effect.bind("accessOutcome", issueAccess),
          Effect.bind("email", ({ reservation, accessOutcome }) =>
            sendRestorationEmail({
              reservation,
              send: input.sendRestorationEmail,
              accessReissued: accessOutcome === "issued",
            })
          ),
          Effect.map(
            ({ email, accessOutcome }): ReservationRestorationResult => ({
              outcome: "restored",
              email,
              access: accessOutcome,
            })
          )
        );

      const restoreCancelledReservation = (
        input: ReservationRestorationInput & {
          readonly reservation: WorkspaceReservation;
          readonly now: Temporal.Instant;
        }
      ) =>
        Effect.succeed(input).pipe(
          Effect.bind("cancellation", getRestorableCancellation),
          Effect.bind("dotyposReservation", ({ cancellation }) =>
            readDotyposReservation(cancellation.dotyposReservationId)
          ),
          Effect.filterOrFail(
            ({ dotyposReservation }) => dotyposReservation.status !== "NEW",
            () => restorationError("changed_in_dotypos")
          ),
          Effect.let("record", ({ dotyposReservation }) =>
            toReservationRecord(dotyposReservation)
          ),
          Effect.bind("expectedBooking", getBooking),
          Effect.bind("span", getHeldSpan),
          Effect.bind("accessPlan", planRestoredAccess),
          Effect.tap(checkRefunds),
          Effect.tap(requireTableAvailable),
          Effect.bind("dotyposRestore", restoreInDotypos),
          Effect.bind("recording", finalizeRestoration),
          Effect.flatMap((restoration) =>
            Match.valueTags(restoration.recording, {
              Recorded: ({ accessPlan }) =>
                completeRestoration({ ...restoration, accessPlan }),
              AlreadyRestored: () => Effect.succeed(alreadyConfirmed),
            })
          )
        );

      return {
        restore: Effect.fn("ReservationRestorationService.restore")((input) =>
          Effect.succeed(input).pipe(
            Effect.bind("now", () => Effect.sync(() => Temporal.Now.instant())),
            Effect.bind("reservation", ({ reservationId }) =>
              loadReservation(reservationId)
            ),
            Effect.flatMap((restoration) =>
              Match.value(restoration.reservation.reservationState).pipe(
                Match.when("confirmed", () =>
                  settleRestoredReservation(restoration)
                ),
                Match.orElse(() => restoreCancelledReservation(restoration))
              )
            )
          )
        ),
      } satisfies IReservationRestorationService;
    })
  );
}

/** Whether Dotypos books the reservation for the customer the restore expects; the table, span and seats are checked by getRestorationBooking. */
const booksCustomer = (
  reservation: DotyposReservation,
  booking: DotyposReservationBooking
) => reservation._customerId === booking.customerId;

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
const requireRefundAcknowledgement = ({
  attempts,
  acknowledgeRefundedPayment,
}: {
  readonly attempts: readonly RestorationRefundAttempt[];
  readonly acknowledgeRefundedPayment: boolean;
}) =>
  Option.fromNullishOr(getRestorationRefund(attempts).refundedPayment).pipe(
    Option.filter(() => !acknowledgeRefundedPayment),
    Option.match({
      onNone: () => Effect.void,
      onSome: (refundedPayment) =>
        Effect.fail(refundAcknowledgementRequired(refundedPayment)),
    })
  );

const refundAcknowledgementRequired = (
  refundedPayment: RestorationRefundedPayment
) =>
  new ReservationAdministrationError({
    code: restorationErrorCodes.refund_acknowledgement_required,
    reason: "refund_acknowledgement_required",
    refundedPayment,
    message: `Nexi already refunded ${formatMoney(refundedPayment.amount, baseLocale)} of this reservation (${refundedPayment.coverage} refund). Acknowledge the refunded payment to restore it.`,
  });
