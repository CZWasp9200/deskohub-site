import {
  type DotyposReservation,
  type DotyposReservationBooking,
  type DotyposReservationId,
  DotyposService,
  type RestoreCancelledReservationResult,
} from "@deskohub/dotypos";
import {
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Result,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
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
  type WorkspaceReservationSessionTakenError,
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

/** Why the restore's transaction rolled back after its Dotypos write. */
type FinalizeRefusal =
  | ReservationAdministrationError
  | RestorationRecordChanged
  | WorkspaceReservationSessionTakenError;

/** The reservation as the restore reread it after its rollback, or why it couldn't. */
type RereadReservation = Result.Result<
  WorkspaceReservation,
  ReservationAdministrationError
>;

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
      const accountingSnapshots = yield* AccountingDocumentSnapshots;
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

      /** Whether another reservation of the checkout session is active. */
      const hasActiveSuccessor = (reservation: WorkspaceReservation) =>
        reservations
          .findCurrentByCheckoutSessionKey(reservation.checkoutSessionKey)
          .pipe(
            Effect.mapError((cause) =>
              restorationError("details_unavailable", cause)
            ),
            Effect.map(
              (successor) =>
                successor !== null && successor.id !== reservation.id
            )
          );

      /**
       * The cancellation a restore undoes, or why the reservation can't be
       * restored as Workspace records it. Every fact is checked again under
       * the restore's locks.
       */
      const getRestorableCancellation = ({
        reservation,
      }: {
        readonly reservation: WorkspaceReservation;
      }) =>
        Effect.succeed(reservation).pipe(
          Effect.filterOrFail(
            ({ reservationState }) => reservationState !== "cancelling",
            () => restorationError("cancellation_in_progress")
          ),
          Effect.filterOrFail(
            ({ reservationState }) => reservationState === "cancelled",
            () => restorationError("invalid_state")
          ),
          Effect.flatMap(hasActiveSuccessor),
          Effect.flatMap((successorActive) =>
            Option.match(
              findRestorableCancellation(reservation, successorActive),
              {
                onNone: () =>
                  Effect.fail(
                    restorationError(
                      successorActive ? "superseded" : "invalid_state"
                    )
                  ),
                onSome: Effect.succeed,
              }
            )
          )
        );

      /**
       * The Dotypos reservation of a confirmed reservation whose
       * cancellation a restore undid, or invalid_state for one that was
       * never cancelled.
       */
      const getUndoneCancellation = ({
        reservation,
      }: {
        readonly reservation: WorkspaceReservation;
      }) =>
        reservations.hasRecordedCancellation(reservation.id).pipe(
          Effect.mapError((cause) =>
            restorationError("details_unavailable", cause)
          ),
          Effect.filterOrFail(
            (wasCancelled) => wasCancelled,
            () => restorationError("invalid_state")
          ),
          Effect.as(reservation.dotyposReservationId),
          Effect.filterOrFail(Predicate.isNotNull, () =>
            restorationError("invalid_state")
          )
        );

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
            AccountingDocumentSnapshots,
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
       * A reread reservation a concurrent restore finished, which the
       * replay checks confirm Dotypos holds: the restore reports it as
       * already confirmed instead of its own refusal.
       */
      const findFinishedRestore = (
        reread: RereadReservation
      ): Effect.Effect<Option.Option<ReservationRestorationResult>> =>
        Option.match(
          Option.filter(
            Result.getSuccess(reread),
            ({ reservationState }) => reservationState === "confirmed"
          ),
          {
            onNone: () => Effect.succeedNone,
            onSome: (reservation) =>
              Effect.option(settleRestoredReservation({ reservation })),
          }
        );

      /**
       * Whether the reread reservation is still the cancellation the restore
       * read while another reservation of its checkout session is active:
       * only then is the Dotypos confirmation still this restore's own
       * write, not a later restore's booking.
       */
      const isStillSuperseded = ({
        reread,
        cancellation,
      }: {
        readonly reread: RereadReservation;
        readonly cancellation: RestorableCancellation;
      }) =>
        Option.match(
          Option.filter(
            Result.getSuccess(reread),
            ({ reservationState, reservationCancelledAt }) =>
              reservationState === "cancelled" &&
              reservationCancelledAt?.equals(cancellation.cancelledAt) === true
          ),
          {
            onNone: () => Effect.succeed(false),
            onSome: (reservation) =>
              hasActiveSuccessor(reservation).pipe(
                Effect.orElseSucceed(() => false)
              ),
          }
        );

      /**
       * Cancels this restore's own Dotypos write again after another
       * reservation took the checkout session, so Dotypos holds only the
       * session's active reservation. A confirmation the restore found
       * already made isn't its own to undo. Whether it compensated.
       */
      const compensateSupersededRestore = ({
        dotyposRestore,
        cancellation,
        reread,
      }: {
        readonly dotyposRestore: RestoreCancelledReservationResult;
        readonly cancellation: RestorableCancellation;
        readonly reread: RereadReservation;
      }) =>
        Match.valueTags(dotyposRestore, {
          AlreadyConfirmed: () => Effect.succeed(false),
          Restored: () =>
            isStillSuperseded({ reread, cancellation }).pipe(
              Effect.flatMap((superseded) =>
                superseded
                  ? dotypos
                      .cancelReservation(cancellation.dotyposReservationId)
                      .pipe(
                        Effect.catch((cancelCause) =>
                          Effect.logError(
                            "A superseded restore left its reservation confirmed in Dotypos while Workspace keeps it cancelled; an operator must cancel it in Dotypos.",
                            cancelCause
                          )
                        ),
                        Effect.as(true)
                      )
                  : Effect.succeed(false)
              )
            ),
        });

      /** The refusal a rolled-back restore reports, given the reservation as it was reread. */
      const getFinalizeRefusal = ({
        refusal,
        reread,
      }: {
        readonly refusal: FinalizeRefusal;
        readonly reread: RereadReservation;
      }) =>
        Match.valueTags(refusal, {
          ReservationAdministrationError: (error) => Effect.succeed(error),
          WorkspaceReservationSessionTakenError: (cause) =>
            Effect.succeed(restorationError("superseded", cause)),
          // The reservation write lost to another change: refused as the
          // reservation now stands.
          RestorationRecordChanged: () =>
            Effect.fromResult(reread).pipe(
              Effect.flatMap((reservation) =>
                getRestorableCancellation({ reservation })
              ),
              Effect.andThen(Effect.fail(restorationError("invalid_state"))),
              Effect.flip
            ),
        });

      /**
       * Refuses a restore after its Dotypos write. Dotypos then holds the
       * reservation CONFIRMED while Workspace keeps it cancelled, unless a
       * superseded restore cancelled its own write again, so that mismatch
       * is logged for an operator.
       */
      const refuseRestoration = (input: {
        readonly cancellation: RestorableCancellation;
        readonly dotyposRestore: RestoreCancelledReservationResult;
        readonly refusal: FinalizeRefusal;
        readonly reread: RereadReservation;
      }) =>
        Effect.all({
          error: getFinalizeRefusal(input),
          compensated:
            input.refusal._tag === "WorkspaceReservationSessionTakenError"
              ? compensateSupersededRestore(input)
              : Effect.succeed(false),
        }).pipe(
          Effect.tap(({ error, compensated }) =>
            compensated
              ? Effect.void
              : Effect.logError(
                  "A refused restore leaves Dotypos confirmed, Workspace cancelled; an operator must reconcile the reservation."
                ).pipe(Effect.annotateLogs({ reason: error.reason }))
          ),
          Effect.flatMap(({ error }) => Effect.fail(error))
        );

      /**
       * Settles a restore whose transaction rolled back after Dotypos
       * confirmed the reservation: it rereads the reservation, reports one
       * a concurrent restore finished as already confirmed, and refuses
       * anything else.
       */
      const settleRefusedRestoration = (input: {
        readonly reservation: WorkspaceReservation;
        readonly cancellation: RestorableCancellation;
        readonly dotyposRestore: RestoreCancelledReservationResult;
        readonly refusal: FinalizeRefusal;
      }) =>
        Effect.result(loadReservation(input.reservation.id)).pipe(
          Effect.flatMap((reread) =>
            findFinishedRestore(reread).pipe(
              Effect.flatMap(
                Option.match({
                  onSome: () =>
                    Effect.succeed(RestorationRecording.AlreadyRestored()),
                  onNone: () => refuseRestoration({ ...input, reread }),
                })
              )
            )
          ),
          Effect.annotateLogs({
            reservationId: input.reservation.id,
            dotyposReservationId: input.cancellation.dotyposReservationId,
          })
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
          Effect.catch((refusal) =>
            settleRefusedRestoration({
              reservation,
              cancellation,
              dotyposRestore,
              refusal,
            })
          )
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
                  ...(reservation.reservationCancelledAt && {
                    cancelledAt: reservation.reservationCancelledAt,
                  }),
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

/** The cancellation of a reservation a restore may undo, as Workspace records it. */
const findRestorableCancellation = (
  reservation: WorkspaceReservation,
  hasActiveSuccessor: boolean
): Option.Option<RestorableCancellation> => {
  const { dotyposReservationId, reservationCancelledAt } = reservation;
  return canRestoreReservation(reservation, { hasActiveSuccessor }) &&
    dotyposReservationId !== null &&
    reservationCancelledAt !== null
    ? Option.some({ cancelledAt: reservationCancelledAt, dotyposReservationId })
    : Option.none();
};

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
