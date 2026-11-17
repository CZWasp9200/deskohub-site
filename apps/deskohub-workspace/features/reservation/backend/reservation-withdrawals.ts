import { Context, Effect, Layer, Match, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentState, ReservationState } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { PaymentAttemptRepository } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import { getReservationProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";
import { getConsumerWithdrawalPeriodCutoff } from "@/features/legal/early-performance";
import type { LegalDocumentKey } from "@/features/legal/legal-document-path";
import {
  ReservationCancellation,
  type ReservationCancellationFailureReason,
} from "@/features/reservation/backend/reservation-cancellation.service";
import { SeatingMapReleaseGate } from "@/features/reservation/backend/seating-map-release-gate";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
  formatReservationDisplayDateTimeRange,
} from "@/features/reservation/reservation-date";
import type { ReservationPurpose } from "@/features/reservation/reservation-purpose";
import {
  assessReservationWithdrawal,
  getReservationServiceSchedule,
} from "@/features/reservation/reservation-withdrawal";
import { WithdrawalRepository } from "@/features/withdrawal/backend/withdrawal.repository";
import { WithdrawalReleaseGate } from "@/features/withdrawal/backend/withdrawal-release-gate";
import {
  ContractCancellationError,
  type WithdrawableContract,
  type WithdrawableContractFamily,
  WithdrawableContractUnavailableError,
} from "@/features/withdrawal/withdrawable-contract";
import type { WithdrawalAvailability } from "@/features/withdrawal/withdrawal-read-model";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

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
          if (paidAttempt?.state !== "paid" || !contractAt) {
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
        cancel: Effect.fn("ReservationWithdrawals.cancel")(function* ({
          contractId,
          refundAmount,
          refundBasis,
        }) {
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
        }),
      } satisfies WithdrawableContractFamily;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(ReservationCancellation.Default),
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationService.Default,
        LegalEvidenceEventRepository.Default,
        PaymentAttemptRepository.Default
      ).pipe(Layer.provideMerge(WorkspaceReservationRepository.Default))
    ),
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDotyposLayer,
        SeatingMapReleaseGate.Live
      )
    )
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
  new Set<ReservationCancellationFailureReason>([
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
    readonly documentKey: string;
    readonly accepted: boolean;
    readonly acceptedAt: Temporal.Instant;
  }[]
) =>
  evidence
    .filter((event) => event.accepted && event.documentKey === termsDocumentKey)
    .map((event) => event.acceptedAt)
    .sort(Temporal.Instant.compare)
    .at(-1);

/** The legal document whose acceptance at payment submit concludes the contract. */
const termsDocumentKey = "terms-and-conditions" satisfies LegalDocumentKey;

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

/** A reservation as the account history lists it, for its withdrawal entry point. */
export type ListedReservation = {
  readonly id: WorkspaceReservationId;
  readonly authorAccountId: CustomerAccountId;
  readonly reservationState: ReservationState;
  readonly paymentState: PaymentState;
  readonly reservationPurpose: ReservationPurpose | null;
  readonly paidAt: Temporal.Instant | null;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
};

interface IReservationWithdrawalAvailability {
  /**
   * Whether the account can withdraw from each listed reservation it
   * authored now, and when each period ends, while the online withdrawal
   * function is released; nothing while it isn't, or when the facts it
   * needs can't be read, since only the entry point depends on it.
   */
  readonly forReservations: (input: {
    readonly accountId: CustomerAccountId;
    readonly reservations: readonly ListedReservation[];
  }) => Effect.Effect<
    ReadonlyMap<WorkspaceReservationId, WithdrawalAvailability>
  >;
}

/** The withdrawal entry points of listed reservations. */
export class ReservationWithdrawalAvailability extends Context.Service<
  ReservationWithdrawalAvailability,
  IReservationWithdrawalAvailability
>()("@deskohub-workspace/reservation/ReservationWithdrawalAvailability") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const legalEvidence = yield* LegalEvidenceEventRepository;
      const withdrawals = yield* WithdrawalRepository;
      const gate = yield* WithdrawalReleaseGate;

      return {
        forReservations: Effect.fn(
          "ReservationWithdrawalAvailability.forReservations"
        )(
          function* ({ accountId, reservations }) {
            const empty = new Map<
              WorkspaceReservationId,
              WithdrawalAvailability
            >();
            const authored = reservations.filter(
              (reservation) =>
                reservation.authorAccountId === accountId &&
                reservation.reservationState === "confirmed" &&
                reservation.paymentState === "paid"
            );
            if (authored.length === 0 || !(yield* gate.isOpen)) return empty;
            const ids = authored.map(({ id }) => id);
            const [evidence, withdrawn] = yield* Effect.all(
              [
                legalEvidence.listForReservations({
                  workspaceReservationIds: ids,
                  limit: ids.length * maxLegalEvidencePerReservation,
                }),
                withdrawals.listWithdrawnContractIds({
                  kind,
                  contractIds: ids,
                }),
              ],
              { concurrency: "inherit" }
            );
            const now = Temporal.Now.instant();
            return new Map(
              authored.flatMap((reservation) => {
                const contractAt =
                  getContractAt(
                    evidence.filter(
                      (event) => event.workspaceReservationId === reservation.id
                    )
                  ) ?? reservation.paidAt;
                if (!contractAt) return [];
                const assessment = assessReservationWithdrawal(
                  {
                    reservationState: reservation.reservationState,
                    paymentState: reservation.paymentState,
                    purpose: reservation.reservationPurpose,
                    contractAt,
                    // Whether the customer may withdraw doesn't depend on
                    // the amount, only the refund does.
                    paidAmount: { value: 0, exponent: 0, currency: "CZK" },
                    schedule: getReservationServiceSchedule(
                      reservation.reservationDetails,
                      reservation.reservedFrom,
                      reservation.reservedUntil
                    ),
                  },
                  now
                );
                return [
                  [
                    reservation.id,
                    {
                      eligible:
                        assessment.withdrawable &&
                        !withdrawn.has(reservation.id),
                      periodEndsAt:
                        getConsumerWithdrawalPeriodCutoff(
                          contractAt
                        ).toString(),
                    },
                  ] as const,
                ];
              })
            );
          },
          (effect) =>
            effect.pipe(
              Effect.tapError((error) =>
                Effect.logWarning(
                  "Reservation withdrawal availability unavailable"
                ).pipe(Effect.annotateLogs({ failureTag: error._tag }))
              ),
              Effect.orElseSucceed(
                () => new Map<WorkspaceReservationId, WithdrawalAvailability>()
              )
            )
        ),
      } satisfies IReservationWithdrawalAvailability;
    })
  );

  static ForProvidedGate = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        LegalEvidenceEventRepository.Live,
        WithdrawalRepository.Live
      )
    )
  );
}
