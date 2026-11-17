import { Context, Effect, Layer, Match, Option, Schema } from "effect";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { PaymentAttemptRepository } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import { getReservationProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";
import {
  type ReservationCancellationFailureReason,
  ReservationCancellation,
} from "@/features/reservation/backend/reservation-cancellation.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
  formatReservationDisplayDateTimeRange,
} from "@/features/reservation/reservation-date";
import {
  assessReservationWithdrawal,
  getReservationServiceSchedule,
} from "@/features/reservation/reservation-withdrawal";
import {
  ContractCancellationError,
  type WithdrawableContract,
  type WithdrawableContractFamily,
  WithdrawableContractUnavailableError,
} from "@/features/withdrawal/withdrawable-contract";

const kind = "reservation" as const;

/**
 * Reservations as withdrawable contracts: cowork, meeting-room and office
 * bookings the signed-in customer authored. The contract is concluded when
 * the customer submits payment, the instant checkout records the accepted
 * terms; a withdrawal cancels the booking through the requested cancellation
 * lifecycle with the refund it owes.
 */
export class ReservationWithdrawals extends Context.Service<
  ReservationWithdrawals,
  WithdrawableContractFamily
>()("@deskohub-workspace/reservation/ReservationWithdrawals") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;
      const legalEvidence = yield* LegalEvidenceEventRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const cancellation = yield* ReservationCancellation;

      const unavailable = (cause: unknown) =>
        new WithdrawableContractUnavailableError({
          kind,
          message: "The reservation could not be read for a withdrawal.",
          cause,
        });

      return {
        kind,
        find: Effect.fn("ReservationWithdrawals.find")(function* (input) {
          const id = Schema.decodeUnknownOption(workspaceReservationIdSchema)(
            input.contractId
          );
          if (Option.isNone(id)) return Option.none();
          const reservation = yield* reservations
            .findById(id.value)
            .pipe(Effect.mapError(unavailable));
          if (!reservation || reservation.authorAccountId !== input.accountId) {
            return Option.none();
          }
          const details = yield* reservationDetails
            .getReservation(reservation.id)
            .pipe(Effect.mapError(unavailable));
          const evidence = yield* legalEvidence
            .listForReservations({
              workspaceReservationIds: [reservation.id],
              limit: maxLegalEvidencePerReservation,
            })
            .pipe(Effect.mapError(unavailable));
          const paidAttempt = reservation.activePaymentAttemptId
            ? yield* paymentAttempts
                .findById(reservation.activePaymentAttemptId)
                .pipe(Effect.mapError(unavailable))
            : null;
          const contractAt = getContractAt(evidence) ?? reservation.paidAt;
          if (!paidAttempt || paidAttempt.state !== "paid" || !contractAt) {
            return Option.none();
          }
          const facts = {
            reservationState: reservation.reservationState,
            paymentState: reservation.paymentState,
            purpose: reservation.reservationPurpose,
            contractAt,
            paidAmount: paidAttempt.amount,
            schedule: getReservationServiceSchedule(
              reservation.reservationDetails,
              details.reservedFrom,
              details.reservedUntil
            ),
          };
          return Option.some<WithdrawableContract>({
            ref: { kind, id: reservation.id },
            label: getReservationContractLabel(details, input.locale),
            paidAmount: paidAttempt.amount,
            assess: (now) => assessReservationWithdrawal(facts, now),
          });
        }),
        cancel: Effect.fn("ReservationWithdrawals.cancel")(
          function* ({ contractId, refundAmount, refundBasis }) {
            const reservationId = Schema.decodeUnknownOption(
              workspaceReservationIdSchema
            )(contractId);
            if (Option.isNone(reservationId)) {
              return yield* new ContractCancellationError({
                kind,
                code: "reservation_invalid_id",
                transient: false,
                message: "The withdrawn reservation id is not valid.",
              });
            }
            const full = refundBasis.kind === "full";
            yield* cancellation
              .cancel({
                reservationId: reservationId.value,
                cause: "customer_withdrawal",
                refund: {
                  ...(!full && { targetValue: refundAmount.value }),
                  releasesPromotions: full,
                },
              })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new ContractCancellationError({
                      kind,
                      code: `reservation_${error.reason}`,
                      transient: transientCancellationReasons.has(error.reason),
                      message: error.message,
                      cause: error,
                    })
                )
              );
          }
        ),
      } satisfies WithdrawableContractFamily;
    })
  );
}

/** Legal evidence a reservation's checkout records: well under this many events. */
const maxLegalEvidencePerReservation = 50;

/**
 * Failures a moment's wait may clear: unreadable state, a provider error, a
 * claim another run holds, or confirmation still finishing. The others need
 * an administrator, though settlement keeps retrying them.
 */
const transientCancellationReasons: ReadonlySet<ReservationCancellationFailureReason> =
  new Set([
    "reservation_unavailable",
    "details_unavailable",
    "claim_failed",
    "dotypos_failed",
    "record_failed",
    "changed",
    "delivery_in_progress",
    "confirmation_in_progress",
  ]);

/**
 * When the customer accepted the terms at payment submit, the contract
 * instant. A submission repeated after a change records evidence again; the
 * latest is the one the payment followed, and it gives the longer period.
 */
const getContractAt = (
  evidence: readonly {
    readonly accepted: boolean;
    readonly acceptedAt: Temporal.Instant;
  }[]
) =>
  evidence
    .filter((event) => event.accepted)
    .map((event) => event.acceptedAt)
    .sort(Temporal.Instant.compare)
    .at(-1);

/** Names the reservation for the statement: product, then when it runs. */
const getReservationContractLabel = (
  details: WorkspaceReservationDetails,
  locale: Locale
) => {
  const when = Match.value(details.reservationDetails).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => formatReservationDisplayDate(details.reservedFrom, locale),
      "meeting-room": () =>
        formatReservationDisplayDateTimeRange(
          details.reservedFrom,
          details.reservedUntil,
          locale
        ),
      office: () =>
        formatReservationDisplayDateRange(
          details.reservedFrom,
          details.reservedUntil,
          locale
        ),
    })
  );
  return `${getReservationProductTitle(details.reservationDetails, locale)} · ${when}`;
};
