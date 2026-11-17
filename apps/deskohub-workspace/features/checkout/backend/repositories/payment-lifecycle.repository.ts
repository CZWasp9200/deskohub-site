import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import {
  discountApplications,
  latePaymentRecoveries,
  paymentAttempts,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import {
  type AccountingDocumentSnapshot,
  getAccountingDocumentSnapshotFirstServiceDate,
} from "@/features/accounting/accounting-document-snapshot";
import {
  AccountingDocumentSnapshots,
  type AccountingRecordUnavailable,
} from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingStorage } from "@/features/accounting/backend/accounting-storage";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import {
  type DiscountCommitment,
  getDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import type { AppliedDiscount } from "@/features/discounts/contracts";
import { DiscountClaimError } from "@/features/discounts/errors";
import type { DiscountApplicationId } from "@/features/discounts/persistence-contracts";
import {
  type PromotionClaim,
  PromotionClaims,
} from "@/features/discounts/promotion-claims";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import type { Locale } from "@/features/i18n";
import { ReferralInvitationLedger } from "@/features/referrals/referral-invitation-ledger";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { type Money, moneyEquals, moneyWithValue } from "@/shared/money/money";
import {
  type PaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";
import {
  findPaymentReservationCustomer,
  lifecycleStateError,
  type NonTerminalPaymentAttemptState,
  PaymentLifecycleStateError,
  type PaymentLifecycleTransition,
} from "./payment-lifecycle-state";
import { PaymentTerminalTransitions } from "./payment-terminal-transitions";

export type PaymentLifecycleRepositoryError =
  | AccountingRecordUnavailable
  | DiscountClaimError
  | EffectDrizzleQueryError
  | PaymentLifecycleStateError
  | SqlError;

export const administrationForcedPaymentCancellationFailureCode =
  "admin_forced_payment_cancellation";

export interface IPaymentLifecycleRepository {
  readonly createPendingNexiAttempt: (input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly providerOrderId: NexiOrderId;
    readonly amount: Money;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
  readonly completeInternalPayment: (input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly amount: Money;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly attachProviderSession: (input: {
    readonly id: PaymentAttemptId;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<
    PaymentAttempt,
    EffectDrizzleQueryError | PaymentLifecycleStateError
  >;
  readonly markPaid: (input: {
    readonly id: PaymentAttemptId;
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    readonly paidAt: Temporal.Instant;
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly markTerminal: (input: {
    readonly id: PaymentAttemptId;
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    /**
     * Non-terminal attempt states the transition may start from; defaults to
     * both. Pass `["created"]` to end an attempt only while no provider
     * session has been attached to it.
     */
    readonly fromAttemptStates?: readonly NonTerminalPaymentAttemptState[];
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
}

/**
 * A payment that settled late on one of the order's earlier attempts is
 * being recovered or was refunded: the order admits no new payment, so a
 * retry never charges it again while that recovery decides.
 */
const noLatePaymentRecovery = notExists(
  sql`(select 1 from ${latePaymentRecoveries} where ${latePaymentRecoveries.workspaceReservationId} = ${workspaceReservations.id})`
);

export class PaymentLifecycleRepository extends Context.Service<
  PaymentLifecycleRepository,
  IPaymentLifecycleRepository
>()("@deskohub-workspace/checkout/PaymentLifecycleRepository") {
  /**
   * The repository over the Workspace database and the accounting snapshots.
   * It composes `PaymentTerminalTransitions` over the same database itself:
   * that module is a part of this one, split out so its interface needs only
   * the database, not a capability callers configure.
   */
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const accountingSnapshots = yield* AccountingDocumentSnapshots;
      const terminalTransitions = yield* PaymentTerminalTransitions;

      const createPendingNexiAttempt = Effect.fn(
        "PaymentLifecycleRepository.createPendingNexiAttempt"
      )(function* (input: {
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly providerOrderId: NexiOrderId;
        readonly amount: Money;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const accountingSnapshot = yield* accountingSnapshots.prepare({
          snapshot: input.accountingSnapshot,
          workspaceReservationId: input.workspaceReservationId,
          amount: input.amount,
          locale: input.locale,
          reference: { type: "providerOrderId", id: input.providerOrderId },
        });
        const commitment = getDiscountCommitmentPayload(input.commitment);
        const claimedApplications =
          yield* validateDiscountCommitment(commitment);
        const firstServiceDate = yield* validateCommitmentFirstServiceDate(
          commitment,
          accountingSnapshot.snapshot
        );

        return yield* transaction(
          Effect.gen(function* () {
            const dotyposCustomerId = yield* findPaymentReservationCustomer(
              "createPendingNexiAttempt",
              input.workspaceReservationId
            );
            yield* ReferralInvitationLedger.lockFirstBooking({
              dotyposCustomerId,
              records: "nothing",
            });

            const [reservation] = yield* db
              .select({
                id: workspaceReservations.id,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                reservationHoldExpiresAt:
                  workspaceReservations.reservationHoldExpiresAt,
              })
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.id, input.workspaceReservationId),
                  noLatePaymentRecovery,
                  eq(workspaceReservations.reservationState, "held"),
                  inArray(workspaceReservations.paymentState, [
                    "not_started",
                    "failed",
                    "cancelled",
                    "expired",
                  ])
                )
              )
              .limit(1)
              .for("update");

            const now = Temporal.Now.instant();
            if (
              !reservation?.reservationHoldExpiresAt ||
              Temporal.Instant.compare(
                reservation.reservationHoldExpiresAt,
                now
              ) <= 0
            ) {
              return yield* new PaymentLifecycleStateError({
                operation:
                  "PaymentLifecycleRepository.createPendingNexiAttempt",
                paymentReference: {
                  type: "providerOrderId",
                  id: input.providerOrderId,
                },
                message:
                  "Payment attempts can only be created for a current held reservation.",
              });
            }

            yield* admitFirstBookingPayment({
              dotyposCustomerId: reservation.dotyposCustomerId,
              workspaceReservationId: input.workspaceReservationId,
              admitsInvitation: claimedApplications.referral !== undefined,
              operation: "createPendingNexiAttempt",
            });

            const [attemptRow] = yield* db
              .insert(paymentAttempts)
              .values({
                id: postgresUuidV7,
                workspaceReservationId: input.workspaceReservationId,
                provider: "nexi",
                providerOrderId: input.providerOrderId,
                state: "created",
                amountValue: input.amount.value,
                amountExponent: input.amount.exponent,
                currency: input.amount.currency,
              })
              .returning();

            if (!attemptRow) {
              return yield* Effect.die(
                "Payment attempt insert returned no row."
              );
            }

            yield* accountingSnapshot.record({
              paymentAttemptId: attemptRow.id,
              dotyposCustomerId: reservation.dotyposCustomerId,
              dotyposReservationId: reservation.dotyposReservationId,
            });

            const [linked] = yield* db
              .update(workspaceReservations)
              .set({
                activePaymentAttemptId: attemptRow.id,
                paymentState: "pending",
                updatedAt: now,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.workspaceReservationId),
                  noLatePaymentRecovery,
                  eq(workspaceReservations.reservationState, "held"),
                  inArray(workspaceReservations.paymentState, [
                    "not_started",
                    "failed",
                    "cancelled",
                    "expired",
                  ])
                )
              )
              .returning({ id: workspaceReservations.id });

            if (!linked) {
              return yield* new PaymentLifecycleStateError({
                operation:
                  "PaymentLifecycleRepository.createPendingNexiAttempt",
                paymentReference: {
                  type: "paymentAttemptId",
                  id: attemptRow.id,
                },
                message:
                  "Payment attempts can only be linked to held unpaid reservations.",
              });
            }

            const applicationRows = yield* persistDiscountApplications({
              commitment,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
            });
            yield* reserveCommittedClaims({
              claimedApplications,
              applicationRows,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              locale: input.locale,
              reservationCustomerId: reservation.dotyposCustomerId,
              reservationExpiresAt: reservation.reservationHoldExpiresAt,
              firstServiceDate,
            });

            return toPaymentAttempt(attemptRow);
          })
        );
      });

      const completeInternalPayment = Effect.fn(
        "PaymentLifecycleRepository.completeInternalPayment"
      )(function* (input: {
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly amount: Money;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const accountingSnapshot = yield* accountingSnapshots.prepare({
          snapshot: input.accountingSnapshot,
          workspaceReservationId: input.workspaceReservationId,
          amount: input.amount,
          locale: input.locale,
          reference: {
            type: "workspaceReservationId",
            id: input.workspaceReservationId,
          },
        });
        const commitment = getDiscountCommitmentPayload(input.commitment);
        const claimedApplications = yield* validateInternalPaymentCommitment(
          commitment,
          input.amount
        );
        const firstServiceDate = yield* validateCommitmentFirstServiceDate(
          commitment,
          accountingSnapshot.snapshot
        );

        if (input.amount.value !== 0) {
          return yield* lifecycleStateError(
            "completeInternalPayment",
            {
              type: "workspaceReservationId",
              id: input.workspaceReservationId,
            },
            "Internal payments require an exactly zero payable amount."
          );
        }

        return yield* transaction(
          Effect.gen(function* () {
            const dotyposCustomerId = yield* findPaymentReservationCustomer(
              "completeInternalPayment",
              input.workspaceReservationId
            );
            yield* ReferralInvitationLedger.lockFirstBooking({
              dotyposCustomerId,
              records: {
                admittedInvitation: claimedApplications.referral !== undefined,
              },
            });

            const [reservation] = yield* db
              .select({
                id: workspaceReservations.id,
                activePaymentAttemptId:
                  workspaceReservations.activePaymentAttemptId,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                paidAt: workspaceReservations.paidAt,
                paymentState: workspaceReservations.paymentState,
                reservationHoldExpiresAt:
                  workspaceReservations.reservationHoldExpiresAt,
                reservationState: workspaceReservations.reservationState,
              })
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, input.workspaceReservationId))
              .limit(1)
              .for("update");

            const paidAt = Temporal.Now.instant();

            const completed = yield* findCompletedInternalPayment(
              input,
              reservation
            );
            if (completed) return completed;

            if (!isCurrentUnpaidHold(reservation, paidAt)) {
              return yield* lifecycleStateError(
                "completeInternalPayment",
                {
                  type: "workspaceReservationId",
                  id: input.workspaceReservationId,
                },
                "Internal payments can only complete a current held unpaid reservation."
              );
            }

            yield* admitFirstBookingPayment({
              dotyposCustomerId: reservation.dotyposCustomerId,
              workspaceReservationId: input.workspaceReservationId,
              admitsInvitation: claimedApplications.referral !== undefined,
              operation: "completeInternalPayment",
            });

            const [attemptRow] = yield* db
              .insert(paymentAttempts)
              .values({
                id: postgresUuidV7,
                workspaceReservationId: input.workspaceReservationId,
                provider: "internal",
                providerOrderId: null,
                state: "paid",
                amountValue: input.amount.value,
                amountExponent: input.amount.exponent,
                currency: input.amount.currency,
                createdAt: paidAt,
                updatedAt: paidAt,
              })
              .returning();

            if (!attemptRow) {
              return yield* Effect.die(
                "Internal payment attempt insert returned no row."
              );
            }

            yield* accountingSnapshot.record({
              paymentAttemptId: attemptRow.id,
              dotyposCustomerId: reservation.dotyposCustomerId,
              dotyposReservationId: reservation.dotyposReservationId,
            });

            const [completedReservation] = yield* db
              .update(workspaceReservations)
              .set({
                activePaymentAttemptId: attemptRow.id,
                paymentState: "paid",
                paidAt,
                failureCode: null,
                updatedAt: paidAt,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.workspaceReservationId),
                  noLatePaymentRecovery,
                  eq(workspaceReservations.reservationState, "held"),
                  inArray(workspaceReservations.paymentState, [
                    "not_started",
                    "failed",
                    "cancelled",
                    "expired",
                  ])
                )
              )
              .returning({ id: workspaceReservations.id });

            if (!completedReservation) {
              return yield* lifecycleStateError(
                "completeInternalPayment",
                { type: "paymentAttemptId", id: attemptRow.id },
                "Internal payment could not atomically complete the held reservation."
              );
            }

            const applicationRows = yield* persistDiscountApplications({
              commitment,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
            });
            const claimedAt = yield* reserveCommittedClaims({
              claimedApplications,
              applicationRows,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              locale: input.locale,
              reservationCustomerId: reservation.dotyposCustomerId,
              reservationExpiresAt: reservation.reservationHoldExpiresAt,
              firstServiceDate,
            });
            yield* redeemInternalPaymentClaims({
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              claimedAt,
            });

            return {
              attempt: toPaymentAttempt(attemptRow),
              changed: true,
              timestamp: paidAt,
            };
          })
        );
      });

      const attachProviderSession = Effect.fn(
        "PaymentLifecycleRepository.attachProviderSession"
      )(function* (input: {
        readonly id: PaymentAttemptId;
        readonly securityToken: string;
        readonly providerRedirectUrl: string;
      }) {
        const providerOrderCreatedAt = Temporal.Now.instant();
        const [attempt] = yield* db
          .update(paymentAttempts)
          .set({
            state: "pending",
            securityToken: input.securityToken,
            providerRedirectUrl: input.providerRedirectUrl,
            providerOrderCreatedAt,
            updatedAt: providerOrderCreatedAt,
          })
          .where(
            and(
              eq(paymentAttempts.id, input.id),
              eq(paymentAttempts.state, "created")
            )
          )
          .returning();

        if (!attempt) {
          return yield* new PaymentLifecycleStateError({
            operation: "PaymentLifecycleRepository.attachProviderSession",
            paymentReference: { type: "paymentAttemptId", id: input.id },
            message:
              "Only created payment attempts can attach a provider session.",
          });
        }

        return toPaymentAttempt(attempt);
      });

      const markPaid = Effect.fn("PaymentLifecycleRepository.markPaid")(
        function* (input: {
          readonly id: PaymentAttemptId;
          readonly workspaceReservationId: WorkspaceReservationId;
          readonly webhookEventId?: NexiWebhookEventId;
          readonly providerOperationId?: NexiOperationId;
          readonly providerStatus?: string;
          readonly paidAt: Temporal.Instant;
        }) {
          return yield* transaction(
            Effect.gen(function* () {
              const dotyposCustomerId = yield* findPaymentReservationCustomer(
                "markPaid",
                input.workspaceReservationId
              );
              yield* ReferralInvitationLedger.lockFirstBooking({
                dotyposCustomerId,
                records: { claimOf: input.id },
              });
              yield* ReferralInvitationLedger.ensureFirstPaid({
                dotyposCustomerId,
                workspaceReservationId: input.workspaceReservationId,
                paymentAttemptId: input.id,
              });

              const [attempt] = yield* db
                .update(paymentAttempts)
                .set({
                  state: "paid",
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  failureCode: null,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    ),
                    inArray(paymentAttempts.state, [
                      "created",
                      "pending",
                      "paid",
                    ])
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only a created, pending, or already-paid attempt can mark a reservation paid."
                );
              }

              const [reservation] = yield* db
                .update(workspaceReservations)
                .set({
                  paymentState: "paid",
                  paidAt: input.paidAt,
                  failureCode: null,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    eq(workspaceReservations.paymentState, "pending"),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .returning({ paidAt: workspaceReservations.paidAt });

              if (reservation) {
                yield* PromotionClaims.redeem({
                  paymentAttemptId: input.id,
                  redeemedAt: input.paidAt,
                });
                yield* ReferralInvitationLedger.redeem({
                  paymentAttemptId: input.id,
                  workspaceReservationId: input.workspaceReservationId,
                  redeemedAt: input.paidAt,
                });
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: reservation.paidAt ?? input.paidAt,
                };
              }

              const [consistent] = yield* db
                .select({ paidAt: workspaceReservations.paidAt })
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.paymentState, "paid"),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .limit(1);

              if (!consistent) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only the active pending attempt on a held reservation can mark payment paid."
                );
              }

              yield* PromotionClaims.redeem({
                paymentAttemptId: input.id,
                redeemedAt: input.paidAt,
              });
              yield* ReferralInvitationLedger.redeem({
                paymentAttemptId: input.id,
                workspaceReservationId: input.workspaceReservationId,
                redeemedAt: input.paidAt,
              });
              return {
                attempt: toPaymentAttempt(attempt),
                changed: false,
                timestamp: consistent.paidAt ?? input.paidAt,
              };
            })
          );
        }
      );

      const markTerminal = Effect.fn("PaymentLifecycleRepository.markTerminal")(
        function* (
          input: Parameters<IPaymentLifecycleRepository["markTerminal"]>[0]
        ) {
          return yield* terminalTransitions.markTerminal(input);
        }
      );

      return {
        createPendingNexiAttempt,
        completeInternalPayment,
        attachProviderSession,
        markPaid,
        markTerminal,
      } satisfies IPaymentLifecycleRepository;
    })
  ).pipe(Layer.provide(PaymentTerminalTransitions.Default));

  /** `Default` over the accounting storage and the Workspace database. */
  static Live = this.Default.pipe(
    Layer.provide(
      Layer.merge(AccountingStorage.Live, WorkspaceDatabase.Default)
    )
  );
}

/**
 * The internal payment that already completed the reservation for this
 * amount, which a repeated completion returns unchanged.
 */
const findCompletedInternalPayment = Effect.fnUntraced(function* (
  input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly amount: Money;
  },
  reservation:
    | Pick<
        WorkspaceReservationRow,
        "paymentState" | "activePaymentAttemptId" | "paidAt"
      >
    | undefined
) {
  const { db } = yield* WorkspaceTransaction;
  if (
    !(
      reservation?.paymentState === "paid" && reservation.activePaymentAttemptId
    )
  ) {
    return undefined;
  }
  const [existingAttempt] = yield* db
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.id, reservation.activePaymentAttemptId),
        eq(
          paymentAttempts.workspaceReservationId,
          input.workspaceReservationId
        ),
        eq(paymentAttempts.provider, "internal"),
        eq(paymentAttempts.state, "paid")
      )
    )
    .limit(1);

  if (
    !existingAttempt ||
    !moneyEquals(toPaymentAttempt(existingAttempt).amount, input.amount)
  ) {
    return undefined;
  }
  return {
    attempt: toPaymentAttempt(existingAttempt),
    changed: false,
    timestamp: reservation.paidAt ?? existingAttempt.updatedAt,
  } satisfies PaymentLifecycleTransition;
});

/** Whether an internal payment may complete the reservation at `at`. */
const isCurrentUnpaidHold = <
  Reservation extends Pick<
    WorkspaceReservationRow,
    "reservationState" | "reservationHoldExpiresAt" | "paymentState"
  >,
>(
  reservation: Reservation | undefined,
  at: Temporal.Instant
): reservation is Reservation & {
  readonly reservationHoldExpiresAt: Temporal.Instant;
} =>
  reservation?.reservationState === "held" &&
  reservation.reservationHoldExpiresAt !== null &&
  Temporal.Instant.compare(reservation.reservationHoldExpiresAt, at) > 0 &&
  ["not_started", "failed", "cancelled", "expired"].includes(
    reservation.paymentState
  );

/** Redeems the claims an internal payment reserved in its transaction. */
const redeemInternalPaymentClaims = Effect.fnUntraced(function* (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly claimedAt: {
    readonly code: Temporal.Instant | undefined;
    readonly referral: Temporal.Instant | undefined;
  };
}) {
  if (input.claimedAt.code) {
    yield* PromotionClaims.redeem({
      paymentAttemptId: input.paymentAttemptId,
      redeemedAt: input.claimedAt.code,
    });
  }
  if (input.claimedAt.referral) {
    yield* ReferralInvitationLedger.redeem({
      paymentAttemptId: input.paymentAttemptId,
      workspaceReservationId: input.workspaceReservationId,
      redeemedAt: input.claimedAt.referral,
    });
  }
});

type CommitmentPayload = ReturnType<typeof getDiscountCommitmentPayload>;

export const validateDiscountCommitment = Effect.fn(
  "PaymentLifecycle.validateDiscountCommitment"
)(function* (commitment: CommitmentPayload) {
  let codeClaimedApplication: OrdinaryClaimedApplication | undefined;
  let referralClaimedApplication: ReferralClaimedApplication | undefined;

  for (const [
    index,
    { application, claim },
  ] of commitment.applications.entries()) {
    yield* requireConsistentApplicationMoney(application, claim);

    if (claim?.kind === "referral_invitation") {
      yield* requireNoEarlierClaim(
        referralClaimedApplication,
        "A payment attempt can reserve one referral invitation claim.",
        claim
      );
      referralClaimedApplication = { index, application, claim };
    } else if (claim) {
      yield* requireNoEarlierClaim(
        codeClaimedApplication,
        "A payment attempt can reserve one ordinary promotion claim.",
        claim
      );
      codeClaimedApplication = { index, application, claim };
    }

    yield* requireClaimedProduct(claim, commitment.product);
  }

  return {
    code: codeClaimedApplication,
    referral: referralClaimedApplication,
  };
});

/** An application takes its amount from its subtotal, in the subtotal's unit. */
const requireConsistentApplicationMoney = (
  application: AppliedDiscount,
  claim: DiscountClaimInstruction | undefined
): Effect.Effect<void, DiscountClaimError> => {
  const amountInSubtotalUnit = moneyWithValue(
    application.amount.value,
    application.subtotalBefore
  );
  const expectedSubtotalAfter = moneyWithValue(
    application.subtotalBefore.value - application.amount.value,
    application.subtotalBefore
  );
  return moneyEquals(amountInSubtotalUnit, application.amount) &&
    moneyEquals(expectedSubtotalAfter, application.subtotalAfter)
    ? Effect.void
    : Effect.fail(
        DiscountClaimError.forClaim(
          "reserve",
          "money_mismatch",
          "A committed discount application has inconsistent money.",
          claim
        )
      );
};

/** A commitment carries at most one claim of each ledger. */
const requireNoEarlierClaim = (
  earlier: ClaimedApplication<DiscountClaimInstruction> | undefined,
  message: string,
  claim: DiscountClaimInstruction
): Effect.Effect<void, DiscountClaimError> =>
  earlier
    ? Effect.fail(
        DiscountClaimError.forClaim("reserve", "claim_conflict", message, claim)
      )
    : Effect.void;

const requireClaimedProduct = (
  claim: DiscountClaimInstruction | undefined,
  product: CommitmentPayload["product"]
): Effect.Effect<void, DiscountClaimError> =>
  claim?.kind === "discount_code" &&
  getWorkspaceProductKey(claim.product) !== getWorkspaceProductKey(product)
    ? Effect.fail(
        DiscountClaimError.forClaim(
          "reserve",
          "product_ineligible",
          "The discount-code claim targets a different product.",
          claim
        )
      )
    : Effect.void;

/**
 * The commitment was affirmed for the reservation this attempt pays for, so
 * the code claim checks service dates against its start date.
 */
const validateCommitmentFirstServiceDate = Effect.fn(
  "PaymentLifecycle.validateCommitmentFirstServiceDate"
)(function* (
  commitment: CommitmentPayload,
  snapshot: AccountingDocumentSnapshot
) {
  const firstServiceDate =
    getAccountingDocumentSnapshotFirstServiceDate(snapshot);
  if (commitment.firstServiceDate !== firstServiceDate) {
    return yield* new DiscountClaimError({
      operation: "reserve",
      reason: "claim_conflict",
      message:
        "The discount commitment was affirmed for a different reservation start date.",
    });
  }
  return firstServiceDate;
});

export const validateInternalPaymentCommitment = Effect.fn(
  "PaymentLifecycle.validateInternalPaymentCommitment"
)(function* (commitment: CommitmentPayload, amount: Money) {
  const claimedApplication = yield* validateDiscountCommitment(commitment);
  const finalSubtotal =
    commitment.applications.at(-1)?.application.subtotalAfter;

  if (!finalSubtotal || !moneyEquals(finalSubtotal, amount)) {
    return yield* new DiscountClaimError({
      operation: "reserve",
      reason: "money_mismatch",
      message:
        "An internal payment commitment must reduce the discountable subtotal to its payable amount.",
    });
  }

  return claimedApplication;
});

/**
 * Admits the payment under the referral first-booking rules, reporting an
 * invited customer's already admitted first payment as a state error.
 */
const admitFirstBookingPayment = (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly admitsInvitation: boolean;
  readonly operation: "createPendingNexiAttempt" | "completeInternalPayment";
}) =>
  ReferralInvitationLedger.admitFirstBooking(input).pipe(
    Effect.catchTag("ReferralFirstBookingAdmittedError", ({ message }) =>
      Effect.fail(
        lifecycleStateError(
          input.operation,
          { type: "workspaceReservationId", id: input.workspaceReservationId },
          message
        )
      )
    )
  );

type ClaimedApplication<Claim extends DiscountClaimInstruction> = {
  readonly index: number;
  readonly application: AppliedDiscount;
  readonly claim: Claim;
};

type ReferralInvitationClaim = Extract<
  DiscountClaimInstruction,
  { readonly kind: "referral_invitation" }
>;
type OrdinaryClaimedApplication = ClaimedApplication<PromotionClaim>;
type ReferralClaimedApplication = ClaimedApplication<ReferralInvitationClaim>;

type ClaimedApplications = {
  readonly code: OrdinaryClaimedApplication | undefined;
  readonly referral: ReferralClaimedApplication | undefined;
};

type PersistedApplication = {
  readonly id: DiscountApplicationId;
  readonly sequence: number;
};

const persistDiscountApplications = Effect.fn(
  "PaymentLifecycle.persistDiscountApplications"
)(function* (input: {
  readonly commitment: CommitmentPayload;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
}) {
  const { db } = yield* WorkspaceTransaction;
  if (input.commitment.applications.length === 0) {
    return [] satisfies PersistedApplication[];
  }

  return yield* db
    .insert(discountApplications)
    .values(
      input.commitment.applications.map(
        ({ application, provenance }, sequence) => ({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.workspaceReservationId,
          sequence,
          publicDiscountId: application.discount.id,
          label: application.discount.label,
          staffLabel: application.discount.staffLabel ?? null,
          adjustment: application.discount.adjustment,
          productIdentity: input.commitment.product,
          subtotalBeforeValue: application.subtotalBefore.value,
          subtotalBeforeExponent: application.subtotalBefore.exponent,
          subtotalBeforeCurrency: application.subtotalBefore.currency,
          appliedAmountValue: application.amount.value,
          appliedAmountExponent: application.amount.exponent,
          appliedAmountCurrency: application.amount.currency,
          subtotalAfterValue: application.subtotalAfter.value,
          subtotalAfterExponent: application.subtotalAfter.exponent,
          subtotalAfterCurrency: application.subtotalAfter.currency,
          expiresAt: application.discount.expiresAt
            ? Temporal.Instant.from(application.discount.expiresAt)
            : null,
          countdownStartsAt: application.discount.countdownStartsAt
            ? Temporal.Instant.from(application.discount.countdownStartsAt)
            : null,
          provenance,
        })
      )
    )
    .returning({
      id: discountApplications.id,
      sequence: discountApplications.sequence,
    });
});

const reserveCommittedClaims = Effect.fn(
  "PaymentLifecycle.reserveCommittedClaims"
)(function* (input: {
  readonly claimedApplications: ClaimedApplications;
  readonly applicationRows: readonly PersistedApplication[];
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly locale: Locale;
  readonly reservationCustomerId: DotyposCustomerId;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly firstServiceDate: string;
}) {
  const findApplicationId = (
    claimed: ClaimedApplication<DiscountClaimInstruction>
  ) =>
    input.applicationRows.find(({ sequence }) => sequence === claimed.index)
      ?.id;

  let code: Temporal.Instant | undefined;
  if (input.claimedApplications.code) {
    const claimed = input.claimedApplications.code;
    const applicationId = findApplicationId(claimed);
    if (!applicationId) {
      return yield* DiscountClaimError.forClaim(
        "reserve",
        "claim_conflict",
        "The claimed discount application was not persisted.",
        claimed.claim
      );
    }
    code = yield* PromotionClaims.admit({
      claim: claimed.claim,
      application: claimed.application,
      applicationId,
      paymentAttemptId: input.paymentAttemptId,
      locale: input.locale,
      reservationCustomerId: input.reservationCustomerId,
      reservationExpiresAt: input.reservationExpiresAt,
      firstServiceDate: input.firstServiceDate,
    }).pipe(
      Effect.catchTag("PromotionClaimHoldEndedError", ({ message }) =>
        Effect.fail(
          lifecycleStateError(
            "reserveCodeClaim",
            { type: "paymentAttemptId", id: input.paymentAttemptId },
            message
          )
        )
      )
    );
  }

  let referral: Temporal.Instant | undefined;
  if (input.claimedApplications.referral) {
    const claimed = input.claimedApplications.referral;
    const applicationId = findApplicationId(claimed);
    if (!applicationId) {
      return yield* DiscountClaimError.forClaim(
        "reserve",
        "claim_conflict",
        "The referral application was not persisted.",
        claimed.claim
      );
    }
    referral = yield* ReferralInvitationLedger.admit({
      claim: claimed.claim,
      application: claimed.application,
      applicationId,
      paymentAttemptId: input.paymentAttemptId,
      reservationCustomerId: input.reservationCustomerId,
      reservationExpiresAt: input.reservationExpiresAt,
      locale: input.locale,
    }).pipe(
      Effect.catchTag("ReferralClaimHoldEndedError", ({ message }) =>
        Effect.fail(
          lifecycleStateError(
            "reserveReferralInvitationClaim",
            { type: "paymentAttemptId", id: input.paymentAttemptId },
            message
          )
        )
      )
    );
  }

  return { code, referral };
});
