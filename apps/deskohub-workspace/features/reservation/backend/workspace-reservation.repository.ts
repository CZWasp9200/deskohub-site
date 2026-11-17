import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
  WorkspaceTransaction,
} from "@/db/database.service";
import { retryDatabaseRead } from "@/db/retry-database-read";
import {
  customerEvents,
  latePaymentRecoveries,
  type PaymentAttemptRow,
  paymentAttempts,
  type ReservationCancellationCause,
  reservationAccessGrants,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { findViolatedConstraint } from "@/db/sql-constraint";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { WorkspaceLocks } from "@/db/workspace-locks";
import type { CustomerAgentClientId } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { newestPaymentAttemptIdOf } from "@/features/checkout/backend/repositories/newest-payment-attempt";
import type {
  CheckoutAttemptKey,
  CheckoutSessionKey,
  PaymentAttemptId,
} from "@/features/checkout/checkout-identifiers";
import type { PaymentReturnTarget } from "@/features/checkout/payment-return-target";
import type { DiscountClaimError } from "@/features/discounts/errors";
import { PromotionClaims } from "@/features/discounts/promotion-claims";
import { ReferralInvitationLedger } from "@/features/referrals/referral-invitation-ledger";
import type { AgentSelectionKey } from "@/features/reservation/backend/booking-agent";
import { withCoworkProductFields } from "@/features/reservation/cowork-reservation-product";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import type { ReservationPurpose } from "@/features/reservation/reservation-purpose";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import {
  type ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { supersedableReservationPaymentStates } from "./reservation-supersession";
import {
  StoredReservationDetails,
  type WithStoredReservationDetails,
  type WorkspaceReservationDetailsMalformedError,
} from "./stored-reservation-details.server";

const withReservationKindFields = (
  reservation: WithStoredReservationDetails<WorkspaceReservationRow>
) => {
  const reservationWithCoworkFields = withCoworkProductFields(reservation);

  // Compose field enrichments for additional reservation kinds here.
  return reservationWithCoworkFields;
};

export type WorkspaceReservation = ReturnType<typeof withReservationKindFields>;

/**
 * The causes of a cancellation a payment retry may book again: only the
 * order's own unpaid hold, released because it expired or for the retry.
 * An operator's cancellation, a superseded checkout or one of unknown origin
 * never is.
 */
export const retryReacquirableCancellationCauses = [
  "hold_expired",
  "payment_retry",
] as const satisfies readonly ReservationCancellationCause[];

/**
 * The order's active attempt is still `retriedAttemptId`, its payment ended
 * without settling, and no late payment is being recovered for it.
 */
/** Payment states of an order whose payment ended unpaid. */
const endedPaymentStates = ["failed", "cancelled", "expired"] as const;

/**
 * The order's payment ended unpaid on the retried attempt, which is still
 * its active attempt, or, once a retry cleared it, still its newest one with
 * none active; no late payment is being recovered for it.
 */
const retriedAttemptEnded = (
  db: WorkspaceDatabaseClient,
  retriedAttemptId: PaymentAttemptId
) =>
  and(
    or(
      eq(workspaceReservations.activePaymentAttemptId, retriedAttemptId),
      and(
        isNull(workspaceReservations.activePaymentAttemptId),
        sql`(${newestPaymentAttemptIdOf(db, workspaceReservations.id)}) = ${retriedAttemptId}`
      )
    ),
    inArray(workspaceReservations.paymentState, endedPaymentStates),
    notExists(
      sql`(select 1 from ${latePaymentRecoveries} where ${latePaymentRecoveries.workspaceReservationId} = ${workspaceReservations.id})`
    )
  );

/** The cancellation causes an unpaid-hold release records. */
type UnpaidHoldReleaseCause = Extract<
  ReservationCancellationCause,
  "hold_expired" | "late_payment" | "payment_retry"
>;

/**
 * The reservation's identifiers and states for log annotations. Scoped
 * annotations reach every later row, query rows included, so never annotate
 * the record.
 */
export const reservationLogFields = (
  reservation: WorkspaceReservation | null | undefined
) => ({
  reservationId: reservation?.id,
  dotyposReservationId: reservation?.dotyposReservationId,
  reservationState: reservation?.reservationState,
  paymentState: reservation?.paymentState,
  fulfillmentState: reservation?.fulfillmentState,
  activePaymentAttemptId: reservation?.activePaymentAttemptId,
});

export class WorkspaceReservationStateError extends Data.TaggedError(
  "WorkspaceReservationStateError"
)<{
  readonly operation: string;
  readonly reservationId: WorkspaceReservationId;
  readonly message: string;
}> {}

/**
 * Restoring the reservation would give its checkout session a second active
 * reservation: another one took the session since it was cancelled.
 */
export class WorkspaceReservationSessionTakenError extends Data.TaggedError(
  "WorkspaceReservationSessionTakenError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly message: string;
}> {}

/** The payment facts of a restored reservation, read in its restore. */
type RestoredReservationPaymentAttempt = Pick<
  PaymentAttemptRow,
  | "amountExponent"
  | "amountValue"
  | "currency"
  | "refundState"
  | "refundedAmountValue"
  | "state"
>;

export interface CreateWorkspaceReservationInput {
  readonly checkoutSessionKey: CheckoutSessionKey;
  readonly checkoutAttemptKey: CheckoutAttemptKey;
  readonly dotyposCustomerId: DotyposCustomerId;
  /** The signed-in account making the reservation. */
  readonly authorAccountId: CustomerAccountId;
  /** The customer's AI agent that started the reservation, if one did. */
  readonly agentClientId?: CustomerAgentClientId;
  /** The agent booking request the reservation answers, if an agent made it. */
  readonly agentSelectionKey?: AgentSelectionKey;
  readonly reservationPurpose: ReservationPurpose;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly locale: string;
  readonly reservationHoldExpiresAt?: Temporal.Instant;
}

/**
 * Creates the first draft of a checkout attempt. `checkoutSessionKey` and
 * `checkoutAttemptKey` are the derivations new rows store, used only when the
 * session and attempt have no row under any accepted derivation.
 */
export interface CreateWorkspaceReservationDraftInput
  extends CreateWorkspaceReservationInput {
  /** Rotation-independent lock identity of the raw checkout session. */
  readonly checkoutSessionLockKey: bigint;
  readonly acceptedCheckoutSessionKeys: readonly CheckoutSessionKey[];
  readonly acceptedCheckoutAttemptKeys: readonly CheckoutAttemptKey[];
}

/**
 * The Dotypos hold a cancellation claim is for. A claim given one takes the
 * reservation only while it still carries that hold and deadline, so a claim
 * made for a hold never takes the hold that replaced it.
 */
export interface ExpectedReservationHold {
  readonly dotyposReservationId: DotyposReservationId;
  readonly reservationHoldExpiresAt: Temporal.Instant;
}

export interface IWorkspaceReservationRepository {
  /**
   * Serializes draft creation per checkout session so workers with different
   * active Pay-state keys or stored lookup-key formats cannot both create a
   * first row. Returns the attempt's existing row, else the session's current
   * row, else the draft inserted under the session's already stored key.
   */
  readonly createDraft: (
    input: CreateWorkspaceReservationDraftInput
  ) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
  >;
  readonly findById: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /** Finds the reservation stored under any accepted derivation of one attempt. */
  readonly findByAttemptKeys: (
    checkoutAttemptKeys: readonly CheckoutAttemptKey[]
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * Returns the session key stored by the latest reservation under any
   * accepted derivation of one checkout session, so every reservation in the
   * session keeps grouping under one key across key rotation.
   */
  readonly findStoredCheckoutSessionKey: (
    checkoutSessionKeys: readonly CheckoutSessionKey[]
  ) => Effect.Effect<CheckoutSessionKey | null, EffectDrizzleQueryError>;
  /**
   * The latest two reservations the account's agent booking request created,
   * newest first: the request's current reservation and the one before it.
   */
  readonly findLatestByAgentSelectionKey: (input: {
    readonly authorAccountId: CustomerAccountId;
    readonly agentSelectionKey: AgentSelectionKey;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * The account's holds through one agent client that a new booking may
   * still supersede: held, with no payment pending or completed.
   */
  readonly findSupersedableByAgentClient: (input: {
    readonly authorAccountId: CustomerAccountId;
    readonly agentClientId: CustomerAgentClientId;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly findCurrentByCheckoutSessionKey: (
    checkoutSessionKey: CheckoutSessionKey
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly updateReservationDetails: (input: {
    readonly id: WorkspaceReservationId;
    readonly reservationDetails: StoredWorkspaceReservationDetails;
    readonly locale: string;
  }) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  /**
   * Stores where the reservation's hosted payment returns the customer:
   * the app a submission asked for, or none for the site's status page. The
   * last submission that hands out a payment page decides, since every
   * submission shares the order's one hosted page and return route.
   */
  readonly recordPaymentReturnTarget: (input: {
    readonly id: WorkspaceReservationId;
    readonly paymentReturnTarget: PaymentReturnTarget | undefined;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  /** The stored payment return target; `undefined` for none or no reservation. */
  readonly findPaymentReturnTarget: (
    id: WorkspaceReservationId
  ) => Effect.Effect<PaymentReturnTarget | undefined, EffectDrizzleQueryError>;
  readonly claimHoldCreation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly releaseHoldCreation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly attachHold: (input: {
    readonly id: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAttachFailedCancellationRequired: (input: {
    readonly id: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  /**
   * Moves an unpaid `held`, `hold_expired` or `cancellation_failed`
   * reservation to `cancelling`. The returned reservation's `updatedAt` is the
   * claim's stamp: only a caller holding it may record the cancellation's
   * outcome.
   */
  readonly claimCancellation: (input: {
    readonly id: WorkspaceReservationId;
    readonly expectedHold?: ExpectedReservationHold;
    /**
     * Why the hold is released; recorded as the cancellation's cause when
     * this claim starts the cancellation. Claiming a `cancellation_failed`
     * reservation again keeps the cause its first claim recorded, so a
     * retried release never relabels another cancellation. A
     * `payment_retry` claim also requires the order's payment to have ended
     * unpaid.
     */
    readonly cause: UnpaidHoldReleaseCause;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * Takes over an unpaid `cancelling` reservation whose claim was stamped at
   * or before `staleBefore`, restamping it, so the interrupted claimant can no
   * longer record an outcome. A fresher claim is left to its claimant.
   */
  readonly takeOverStaleCancellation: (input: {
    readonly id: WorkspaceReservationId;
    readonly staleBefore: Temporal.Instant;
    readonly expectedHold?: ExpectedReservationHold;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * Prepares an order's payment retry on the hold it still carries: clears
   * its active attempt when that is still the retried one, whose payment
   * ended (failed, cancelled or expired), the hold is unexpired and held, and
   * no late payment is being recovered for it. From then on a late payment on
   * the retried attempt settles as a refund and never touches this hold.
   * Null when the order no longer matches.
   */
  readonly releaseRetriedAttempt: (input: {
    readonly id: WorkspaceReservationId;
    readonly retriedAttemptId: PaymentAttemptId;
    readonly heldUntilAfter: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * Puts a new Dotypos hold on an order whose own unpaid hold was released
   * for expiry or for this retry, clearing the retried attempt as
   * `releaseRetriedAttempt` does and every trace of the cancellation. Null
   * when the order is no longer that cancelled, unpaid order of the retried
   * attempt, or a late payment is being recovered for it.
   */
  readonly attachRetryHold: (input: {
    readonly id: WorkspaceReservationId;
    readonly retriedAttemptId: PaymentAttemptId;
    readonly dotyposReservationId: DotyposReservationId;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly claimSupersessionCancellation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly claimAdministrationCancellation: (input: {
    readonly id: WorkspaceReservationId;
    readonly pendingPaymentCancellation?: {
      readonly paymentAttemptId: PaymentAttemptId;
      readonly failureCode: string;
    };
    readonly staleCancellingBefore: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    | DiscountClaimError
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  /** Records the cancellation of the claim stamped `claimedAt`. */
  readonly markCancelled: (input: {
    readonly id: WorkspaceReservationId;
    readonly claimedAt: Temporal.Instant;
    readonly cancelledAt: Temporal.Instant;
    readonly holdExpiredAt?: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAdministrationCancelled: (input: {
    readonly id: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly claimedAt: Temporal.Instant;
    readonly failureCode: string | null;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError.SqlError | WorkspaceReservationStateError
  >;
  /**
   * Confirms an administrator-cancelled reservation again, in the restore's
   * transaction, once Dotypos confirmed it. Applies only while the row is
   * still the cancellation the restore read (`cancelledAt`) and still meets
   * the restore predicate; returns null otherwise. Clears the cancellation
   * and its email record, keeps confirmation and fulfillment, and moves its
   * attempts still awaiting a refund to `not_required`; refund facts stay.
   * Returns the restored row and its payment attempts as they now stand.
   * Fails with `WorkspaceReservationSessionTakenError` when another
   * reservation of its checkout session is active; the failed statement
   * aborts the caller's transaction, which must roll back.
   */
  readonly markAdministrationRestored: (input: {
    readonly id: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly restoredAt: Temporal.Instant;
  }) => Effect.Effect<
    {
      readonly reservation: WorkspaceReservation;
      readonly paymentAttempts: readonly RestoredReservationPaymentAttempt[];
    } | null,
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationSessionTakenError,
    WorkspaceTransaction
  >;
  /**
   * Records that the cancellation email of the cancellation at `cancelledAt`
   * was sent. False when the reservation is no longer that cancellation.
   */
  readonly recordCancellationEmailSent: (input: {
    readonly id: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly sentAt: Temporal.Instant;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /**
   * Whether the reservation was ever cancelled as a booked reservation: a
   * `reservation-cancelled` customer event records it. A confirmed row with
   * one was restored, since nothing else confirms a row after such a
   * cancellation (see the implementation).
   */
  readonly hasRecordedCancellation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly completeSupersessionAndCreateDraft: (input: {
    readonly cancelledReservationId: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly replacement: CreateWorkspaceReservationInput;
  }) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  /** Records the failure of the claim stamped `claimedAt`. */
  readonly markCancellationFailed: (input: {
    readonly id: WorkspaceReservationId;
    readonly claimedAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAdministrationCancellationFailed: (input: {
    readonly id: WorkspaceReservationId;
    readonly claimedAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly recordHoldCleanupSkipped: (input: {
    readonly id: WorkspaceReservationId;
    readonly holdExpiredAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  /** Records the booked customer event in the confirmation's transaction. */
  readonly markReservationConfirmed: (input: {
    readonly id: WorkspaceReservationId;
    readonly confirmedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError.SqlError | WorkspaceReservationStateError
  >;
  readonly selectExpiredHolds: (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly selectExpiredHoldDotyposReservationIds: (input: {
    readonly now: Temporal.Instant;
  }) => Effect.Effect<readonly DotyposReservationId[], EffectDrizzleQueryError>;
  /**
   * The Workspace reservations made for one Dotypos customer, oldest first,
   * as the customer may read them. Only rows whose reservation customer is
   * `dotyposCustomerId` are read: a reservation the customer's account
   * authored for another customer belongs to that customer and is excluded,
   * whoever authored a row is irrelevant, and the author is not returned.
   * Checkout keys, payment-return targets, hold and failure bookkeeping, and
   * agent identifiers are never read. Fails with `ReadLimitExceededError`,
   * returning nothing, when the customer has more than `limit` rows, and with
   * `WorkspaceReservationDetailsMalformedError` when a row's stored product
   * document is malformed.
   */
  readonly listForCustomer: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerReservationRecord[],
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | ReadLimitExceededError
  >;
}

/**
 * What a customer may read about one Workspace reservation made for them:
 * its lifecycle and the product they chose. `product` is the stored product
 * document, decoded strictly.
 */
export type CustomerReservationRecord = Pick<
  WorkspaceReservationRow,
  | "id"
  | "dotyposReservationId"
  | "reservationPurpose"
  | "reservationState"
  | "paymentState"
  | "fulfillmentState"
  | "locale"
  | "reservationCreatedAt"
  | "reservationConfirmedAt"
  | "reservationCancelledAt"
  | "paidAt"
  | "fulfilledAt"
> & {
  readonly product: StoredWorkspaceReservationDetails;
};

export const ensureUpdated = (
  updated: readonly Pick<WorkspaceReservation, "id">[],
  operation: string,
  reservationId: WorkspaceReservationId,
  message: string
) =>
  updated.length > 0
    ? Effect.void
    : Effect.fail(
        new WorkspaceReservationStateError({
          operation,
          reservationId,
          message,
        })
      );

type AdministrationCancellationClaim = Parameters<
  IWorkspaceReservationRepository["claimAdministrationCancellation"]
>[0];

type PendingPaymentCancellation = NonNullable<
  AdministrationCancellationClaim["pendingPaymentCancellation"]
>;

/** Grant states whose door credential Igloohome may still hold. */
const liveAccessGrantStates: readonly string[] = [
  "issued",
  "uncertain",
  "provisioning",
];

const isLiveAccessGrantState = (state: string) =>
  liveAccessGrantStates.includes(state);

/**
 * Inserts the checkout attempt's first draft under the session's key, or
 * nothing when a unique index already holds the attempt or the session.
 */
const recordReservationDraft = Effect.fnUntraced(function* (
  input: CreateWorkspaceReservationDraftInput,
  checkoutSessionKey: CheckoutSessionKey
) {
  const { db } = yield* WorkspaceTransaction;
  return yield* db
    .insert(workspaceReservations)
    .values({
      id: postgresUuidV7,
      checkoutSessionKey,
      checkoutAttemptKey: input.checkoutAttemptKey,
      correlationId: postgresUuidV7,
      dotyposCustomerId: input.dotyposCustomerId,
      authorAccountId: input.authorAccountId,
      agentClientId: input.agentClientId ?? null,
      agentSelectionKey: input.agentSelectionKey ?? null,
      reservationPurpose: input.reservationPurpose,
      reservationState: "draft",
      paymentState: "not_started",
      fulfillmentState: "not_started",
      reservationDetails: yield* StoredReservationDetails.encode(
        input.reservationDetails
      ),
      locale: input.locale,
      reservationHoldExpiresAt: input.reservationHoldExpiresAt,
    })
    .onConflictDoNothing()
    .returning();
});

/** Locks the reservation's access grant row, if it has one. */
const lockAccessGrantOfReservation = Effect.fnUntraced(function* (
  reservationId: WorkspaceReservationId
) {
  const { db } = yield* WorkspaceTransaction;
  return yield* db
    .select({
      id: reservationAccessGrants.id,
      state: reservationAccessGrants.state,
    })
    .from(reservationAccessGrants)
    .where(eq(reservationAccessGrants.workspaceReservationId, reservationId))
    .limit(1)
    .for("update");
});

type LockedAccessGrant = Effect.Success<
  ReturnType<typeof lockAccessGrantOfReservation>
>[number];

/** Matches a reservation still carrying `expected`, or any without one. */
const carriesExpectedHold = (expected: ExpectedReservationHold | undefined) =>
  expected &&
  and(
    eq(
      workspaceReservations.dotyposReservationId,
      expected.dotyposReservationId
    ),
    eq(
      workspaceReservations.reservationHoldExpiresAt,
      expected.reservationHoldExpiresAt
    )
  );

/**
 * Moves the reservation to `cancelling` from a cancellable state or a stale
 * cancellation, cancelling its pending payment when the claim forces that.
 */
const recordAdministrationCancellationClaim = Effect.fnUntraced(function* (
  input: AdministrationCancellationClaim,
  now: Temporal.Instant
) {
  const { db } = yield* WorkspaceTransaction;
  return yield* db
    .update(workspaceReservations)
    .set({
      reservationState: "cancelling",
      // An administrator's cancellation is never the customer's to retry. A
      // cancellation another claim started, now resumed by an administrator,
      // keeps the cause that claim recorded (null when unknown).
      cancellationCause: sql`case when ${workspaceReservations.reservationState} in ('held', 'hold_expired', 'confirmed') then 'operator' else ${workspaceReservations.cancellationCause} end`,
      ...(input.pendingPaymentCancellation && {
        paymentState: "cancelled" as const,
        failureCode: input.pendingPaymentCancellation.failureCode,
      }),
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceReservations.id, input.id),
        or(
          inArray(workspaceReservations.reservationState, [
            "held",
            "hold_expired",
            "confirmed",
            "cancellation_failed",
          ]),
          and(
            eq(workspaceReservations.reservationState, "cancelling"),
            lte(workspaceReservations.updatedAt, input.staleCancellingBefore)
          )
        ),
        input.pendingPaymentCancellation
          ? and(
              eq(workspaceReservations.paymentState, "pending"),
              eq(
                workspaceReservations.activePaymentAttemptId,
                input.pendingPaymentCancellation.paymentAttemptId
              )
            )
          : sql`${workspaceReservations.paymentState} <> 'pending'`,
        sql`${workspaceReservations.fulfillmentState} <> 'processing'`,
        sql`${workspaceReservations.fulfillmentState} <> 'awaiting_delivery'`
      )
    )
    .returning();
});

/**
 * Takes the referral lock that releasing a payment attempt's invitation claim
 * runs under, as every payment transition that releases one does. It ranks
 * first, so the cancellation takes it before any row lock.
 */
const lockReferralClaimRelease = Effect.fnUntraced(function* (
  reservationId: WorkspaceReservationId
) {
  const { db } = yield* WorkspaceTransaction;
  const [reservation] = yield* db
    .select({ dotyposCustomerId: workspaceReservations.dotyposCustomerId })
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, reservationId))
    .limit(1);
  if (!reservation) return;
  yield* ReferralInvitationLedger.lockFirstBooking({
    dotyposCustomerId: reservation.dotyposCustomerId,
    records: "nothing",
  });
});

/**
 * Cancels the reservation's active payment attempt and releases its discount
 * and referral invitation claims, under `lockReferralClaimRelease`; fails when
 * the attempt can no longer be cancelled.
 */
const cancelPendingPaymentAttempt = Effect.fnUntraced(function* (
  reservationId: WorkspaceReservationId,
  pendingPaymentCancellation: PendingPaymentCancellation,
  now: Temporal.Instant
) {
  const { db } = yield* WorkspaceTransaction;
  const [attempt] = yield* db
    .update(paymentAttempts)
    .set({
      state: "cancelled",
      failureCode: pendingPaymentCancellation.failureCode,
      updatedAt: now,
    })
    .where(
      and(
        eq(paymentAttempts.id, pendingPaymentCancellation.paymentAttemptId),
        eq(paymentAttempts.workspaceReservationId, reservationId),
        inArray(paymentAttempts.state, ["created", "pending", "cancelled"])
      )
    )
    .returning({ id: paymentAttempts.id });
  if (!attempt) {
    return yield* new WorkspaceReservationStateError({
      operation: "workspaceReservations.claimAdministrationCancellation",
      reservationId,
      message: "The active payment attempt could not be cancelled.",
    });
  }
  const release = {
    paymentAttemptId: pendingPaymentCancellation.paymentAttemptId,
    releasedAt: now,
    releaseReason: pendingPaymentCancellation.failureCode,
  };
  yield* PromotionClaims.release(release);
  yield* ReferralInvitationLedger.release(release);
});

/** The statement gave the checkout session a second active reservation. */
const isActiveSessionTaken = (error: EffectDrizzleQueryError) =>
  findViolatedConstraint(error).pipe(
    Option.exists(
      (constraint) =>
        constraint === "workspace_reservations_active_session_unique_idx"
    )
  );

/** Expires the grant and forgets its access code. */
const expireAccessGrant = Effect.fnUntraced(function* (
  grantId: LockedAccessGrant["id"],
  now: Temporal.Instant
) {
  const { db } = yield* WorkspaceTransaction;
  yield* db
    .update(reservationAccessGrants)
    .set({
      state: "expired",
      accessCode: null,
      updatedAt: now,
    })
    .where(eq(reservationAccessGrants.id, grantId));
});

export class WorkspaceReservationRepository extends Context.Service<
  WorkspaceReservationRepository,
  IWorkspaceReservationRepository
>()("WorkspaceReservationRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const selectLatestByAttemptKeys = (
        checkoutAttemptKeys: readonly CheckoutAttemptKey[]
      ) =>
        db
          .select()
          .from(workspaceReservations)
          .where(
            inArray(
              workspaceReservations.checkoutAttemptKey,
              checkoutAttemptKeys
            )
          )
          .orderBy(desc(workspaceReservations.createdAt))
          .limit(1);

      const selectStoredCheckoutSessionKey = (
        checkoutSessionKeys: readonly CheckoutSessionKey[]
      ) =>
        db
          .select({
            checkoutSessionKey: workspaceReservations.checkoutSessionKey,
          })
          .from(workspaceReservations)
          .where(
            inArray(
              workspaceReservations.checkoutSessionKey,
              checkoutSessionKeys
            )
          )
          .orderBy(desc(workspaceReservations.createdAt))
          .limit(1);

      const selectCurrentBySessionKey = (
        checkoutSessionKey: CheckoutSessionKey
      ) =>
        db
          .select()
          .from(workspaceReservations)
          .where(
            and(
              eq(workspaceReservations.checkoutSessionKey, checkoutSessionKey),
              sql`${workspaceReservations.reservationState} <> 'cancelled'`
            )
          )
          .orderBy(desc(workspaceReservations.createdAt))
          .limit(1);

      // Writers that skip the checkout-session lock can still win a unique
      // index on the draft insert: a worker from before the lock may have
      // stored this attempt, even if it is already cancelled, and supersession
      // inserts its replacement as the session's current row.
      const findDraftAfterInsertConflict = Effect.fnUntraced(function* (
        acceptedCheckoutAttemptKeys: readonly CheckoutAttemptKey[],
        checkoutSessionKey: CheckoutSessionKey
      ) {
        const [conflictingAttempt] = yield* selectLatestByAttemptKeys(
          acceptedCheckoutAttemptKeys
        );
        if (conflictingAttempt) {
          return yield* decodeWorkspaceReservation(conflictingAttempt);
        }
        const [replacement] =
          yield* selectCurrentBySessionKey(checkoutSessionKey);
        if (!replacement) {
          return yield* Effect.die(
            "Workspace reservation insert returned no row."
          );
        }
        return yield* decodeWorkspaceReservation(replacement);
      });

      const findById = Effect.fn("workspaceReservations.findById")(
        function* (id: WorkspaceReservationId) {
          const [reservation] = yield* db
            .select()
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, id))
            .limit(1);
          return yield* decodeOptionalWorkspaceReservation(reservation);
        },
        (effect, reservationId) =>
          effect.pipe(Effect.annotateLogs({ reservationId }))
      );

      return {
        createDraft: Effect.fn("workspaceReservations.createDraft")(
          function* (input) {
            return yield* transaction(
              Effect.gen(function* () {
                yield* WorkspaceLocks.checkoutSession(
                  input.checkoutSessionLockKey
                );

                const [existingAttempt] = yield* selectLatestByAttemptKeys(
                  input.acceptedCheckoutAttemptKeys
                );
                if (existingAttempt) {
                  return yield* decodeWorkspaceReservation(existingAttempt);
                }

                const [storedSession] = yield* selectStoredCheckoutSessionKey(
                  input.acceptedCheckoutSessionKeys
                );
                const checkoutSessionKey =
                  storedSession?.checkoutSessionKey ?? input.checkoutSessionKey;

                const [currentSessionRow] =
                  yield* selectCurrentBySessionKey(checkoutSessionKey);
                if (currentSessionRow) {
                  return yield* decodeWorkspaceReservation(currentSessionRow);
                }

                const [inserted] = yield* recordReservationDraft(
                  input,
                  checkoutSessionKey
                );
                if (inserted) {
                  return yield* decodeWorkspaceReservation(inserted);
                }

                return yield* findDraftAfterInsertConflict(
                  input.acceptedCheckoutAttemptKeys,
                  checkoutSessionKey
                );
              })
            );
          },
          (effect, input) =>
            effect.pipe(
              Effect.annotateLogs({
                checkoutSessionKey: input.checkoutSessionKey,
                checkoutAttemptKey: input.checkoutAttemptKey,
                dotyposCustomerId: input.dotyposCustomerId,
              })
            )
        ),
        findById,
        findByAttemptKeys: Effect.fn("workspaceReservations.findByAttemptKeys")(
          function* (checkoutAttemptKeys) {
            const [reservation] =
              yield* selectLatestByAttemptKeys(checkoutAttemptKeys);
            return yield* decodeOptionalWorkspaceReservation(reservation);
          },
          (effect, checkoutAttemptKeys) =>
            effect.pipe(
              Effect.annotateLogs({
                checkoutAttemptKey: checkoutAttemptKeys[0],
              })
            )
        ),
        findStoredCheckoutSessionKey: Effect.fn(
          "workspaceReservations.findStoredCheckoutSessionKey"
        )(
          function* (checkoutSessionKeys) {
            const [reservation] =
              yield* selectStoredCheckoutSessionKey(checkoutSessionKeys);
            return reservation?.checkoutSessionKey ?? null;
          },
          (effect, checkoutSessionKeys) =>
            effect.pipe(
              Effect.annotateLogs({
                checkoutSessionKey: checkoutSessionKeys[0],
              })
            )
        ),
        findLatestByAgentSelectionKey: Effect.fn(
          "workspaceReservations.findLatestByAgentSelectionKey"
        )(function* (input) {
          const rows = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.agentSelectionKey,
                  input.agentSelectionKey
                ),
                eq(workspaceReservations.authorAccountId, input.authorAccountId)
              )
            )
            .orderBy(
              desc(workspaceReservations.createdAt),
              desc(workspaceReservations.id)
            )
            .limit(2);
          return yield* Effect.forEach(rows, decodeWorkspaceReservation);
        }),
        findSupersedableByAgentClient: Effect.fn(
          "workspaceReservations.findSupersedableByAgentClient"
        )(function* (input) {
          const rows = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.authorAccountId,
                  input.authorAccountId
                ),
                eq(workspaceReservations.agentClientId, input.agentClientId),
                eq(workspaceReservations.reservationState, "held"),
                inArray(
                  workspaceReservations.paymentState,
                  supersedableReservationPaymentStates
                )
              )
            )
            .orderBy(
              desc(workspaceReservations.createdAt),
              desc(workspaceReservations.id)
            );
          return yield* Effect.forEach(rows, decodeWorkspaceReservation);
        }),
        findCurrentByCheckoutSessionKey: Effect.fn(
          "workspaceReservations.findCurrentByCheckoutSessionKey"
        )(
          function* (checkoutSessionKey) {
            const [reservation] =
              yield* selectCurrentBySessionKey(checkoutSessionKey);
            return yield* decodeOptionalWorkspaceReservation(reservation);
          },
          (effect, checkoutSessionKey) =>
            effect.pipe(Effect.annotateLogs({ checkoutSessionKey }))
        ),
        updateReservationDetails: Effect.fn(
          "workspaceReservations.updateReservationDetails"
        )(function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationDetails: yield* StoredReservationDetails.encode(
                input.reservationDetails
              ),
              locale: input.locale,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                inArray(workspaceReservations.reservationState, [
                  "draft",
                  "held",
                ])
              )
            )
            .returning();
          if (!updated[0]) {
            return yield* new WorkspaceReservationStateError({
              operation: "workspaceReservations.updateReservationDetails",
              reservationId: input.id,
              message:
                "Only draft or held reservations can refresh reservation details.",
            });
          }
          return yield* decodeWorkspaceReservation(updated[0]);
        }),
        // A navigation preference, not reservation state: it leaves
        // `updatedAt`, which sweeps and status ordering read, untouched.
        recordPaymentReturnTarget: Effect.fn(
          "workspaceReservations.recordPaymentReturnTarget"
        )(
          function* (input) {
            const paymentReturnTarget = input.paymentReturnTarget ?? null;
            yield* db
              .update(workspaceReservations)
              .set({ paymentReturnTarget })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  sql`${workspaceReservations.paymentReturnTarget} is distinct from ${paymentReturnTarget}`
                )
              );
          },
          (effect, input) =>
            effect.pipe(Effect.annotateLogs({ reservationId: input.id }))
        ),
        findPaymentReturnTarget: Effect.fn(
          "workspaceReservations.findPaymentReturnTarget"
        )(
          function* (id) {
            const [reservation] = yield* db
              .select({
                paymentReturnTarget: workspaceReservations.paymentReturnTarget,
              })
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, id))
              .limit(1)
              .pipe(retryDatabaseRead);
            return reservation?.paymentReturnTarget ?? undefined;
          },
          (effect, reservationId) =>
            effect.pipe(Effect.annotateLogs({ reservationId }))
        ),
        claimHoldCreation: Effect.fn("workspaceReservations.claimHoldCreation")(
          function* (id) {
            const updated = yield* db
              .update(workspaceReservations)
              .set({
                reservationState: "creating_hold",
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, id),
                  eq(workspaceReservations.reservationState, "draft")
                )
              )
              .returning({ id: workspaceReservations.id });
            return updated.length > 0;
          },
          (effect, reservationId) =>
            effect.pipe(Effect.annotateLogs({ reservationId }))
        ),
        releaseHoldCreation: Effect.fn(
          "workspaceReservations.releaseHoldCreation"
        )(function* (id) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "draft",
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, id),
                eq(workspaceReservations.reservationState, "creating_hold"),
                sql`${workspaceReservations.dotyposReservationId} is null`
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.releaseHoldCreation",
            id,
            "Only unattached creating_hold reservations can be released."
          );
        }),
        attachHold: Effect.fn("workspaceReservations.attachHold")(
          function* (input) {
            const updated = yield* db
              .update(workspaceReservations)
              .set({
                dotyposReservationId: input.dotyposReservationId,
                reservationState: "held",
                reservationCreatedAt: input.reservationCreatedAt,
                reservationHoldExpiresAt: input.reservationHoldExpiresAt,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "creating_hold")
                )
              )
              .returning({ id: workspaceReservations.id });
            yield* ensureUpdated(
              updated,
              "workspaceReservations.attachHold",
              input.id,
              "Only creating_hold reservations can attach a Dotypos hold."
            );
          }
        ),
        markAttachFailedCancellationRequired: Effect.fn(
          "workspaceReservations.markAttachFailedCancellationRequired"
        )(function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              dotyposReservationId: input.dotyposReservationId,
              reservationCreatedAt: input.reservationCreatedAt,
              reservationState: "cancellation_failed",
              failureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "creating_hold")
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markAttachFailedCancellationRequired",
            input.id,
            "Only creating_hold reservations can record attach-cancel recovery."
          );
        }),
        claimCancellation: Effect.fn("workspaceReservations.claimCancellation")(
          function* (input) {
            const [claimed] = yield* db
              .update(workspaceReservations)
              .set({
                reservationState: "cancelling",
                cancellationCause: sql`case when ${workspaceReservations.reservationState} in ('held', 'hold_expired') then ${input.cause} else ${workspaceReservations.cancellationCause} end`,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  inArray(workspaceReservations.reservationState, [
                    "held",
                    "hold_expired",
                    "cancellation_failed",
                  ]),
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  sql`${workspaceReservations.reservationState} <> 'confirmed'`,
                  // A retry releases only the hold of a payment that ended,
                  // never one a payment admitted meanwhile is using.
                  input.cause === "payment_retry"
                    ? inArray(
                        workspaceReservations.paymentState,
                        endedPaymentStates
                      )
                    : undefined,
                  carriesExpectedHold(input.expectedHold)
                )
              )
              .returning();
            return yield* decodeOptionalWorkspaceReservation(claimed);
          }
        ),
        takeOverStaleCancellation: Effect.fn(
          "workspaceReservations.takeOverStaleCancellation"
        )(function* (input) {
          const [claimed] = yield* db
            .update(workspaceReservations)
            .set({ updatedAt: Temporal.Now.instant() })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "cancelling"),
                lte(workspaceReservations.updatedAt, input.staleBefore),
                sql`${workspaceReservations.paymentState} <> 'paid'`,
                carriesExpectedHold(input.expectedHold)
              )
            )
            .returning();
          return yield* decodeOptionalWorkspaceReservation(claimed);
        }),
        releaseRetriedAttempt: Effect.fn(
          "workspaceReservations.releaseRetriedAttempt"
        )(function* (input) {
          const [released] = yield* db
            .update(workspaceReservations)
            .set({
              activePaymentAttemptId: null,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "held"),
                gt(
                  workspaceReservations.reservationHoldExpiresAt,
                  input.heldUntilAfter
                ),
                retriedAttemptEnded(db, input.retriedAttemptId)
              )
            )
            .returning();
          return yield* decodeOptionalWorkspaceReservation(released);
        }),
        attachRetryHold: Effect.fn("workspaceReservations.attachRetryHold")(
          function* (input) {
            const [attached] = yield* db
              .update(workspaceReservations)
              .set({
                reservationState: "held",
                dotyposReservationId: input.dotyposReservationId,
                reservationHoldExpiresAt: input.reservationHoldExpiresAt,
                reservationHoldExpiredAt: null,
                reservationCancelledAt: null,
                cancellationCause: null,
                failureCode: null,
                activePaymentAttemptId: null,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "cancelled"),
                  inArray(workspaceReservations.cancellationCause, [
                    ...retryReacquirableCancellationCauses,
                  ]),
                  retriedAttemptEnded(db, input.retriedAttemptId)
                )
              )
              .returning();
            return yield* decodeOptionalWorkspaceReservation(attached);
          }
        ),
        claimSupersessionCancellation: Effect.fn(
          "workspaceReservations.claimSupersessionCancellation"
        )(function* (id) {
          const [claimed] = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancelling",
              cancellationCause: "checkout_superseded",
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, id),
                eq(workspaceReservations.reservationState, "held"),
                inArray(
                  workspaceReservations.paymentState,
                  supersedableReservationPaymentStates
                )
              )
            )
            .returning();
          return yield* decodeOptionalWorkspaceReservation(claimed);
        }),
        claimAdministrationCancellation: Effect.fn(
          "workspaceReservations.claimAdministrationCancellation"
        )(function* (input) {
          const claim = transaction(
            Effect.gen(function* () {
              const now = Temporal.Now.instant();
              if (input.pendingPaymentCancellation) {
                yield* lockReferralClaimRelease(input.id);
              }
              const [grant] = yield* lockAccessGrantOfReservation(input.id);
              const [claimed] = yield* recordAdministrationCancellationClaim(
                input,
                now
              );
              if (!claimed) return null;

              if (input.pendingPaymentCancellation) {
                yield* cancelPendingPaymentAttempt(
                  input.id,
                  input.pendingPaymentCancellation,
                  now
                );
              }

              if (grant && isLiveAccessGrantState(grant.state)) {
                yield* expireAccessGrant(grant.id, now);
              }
              return yield* decodeWorkspaceReservation(claimed);
            })
          );
          return yield* claim;
        }),
        markCancelled: Effect.fn("workspaceReservations.markCancelled")(
          function* (input) {
            const updated = yield* db
              .update(workspaceReservations)
              .set({
                reservationState: "cancelled",
                reservationCancelledAt: input.cancelledAt,
                reservationHoldExpiredAt: input.holdExpiredAt,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "cancelling"),
                  eq(workspaceReservations.updatedAt, input.claimedAt),
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  sql`${workspaceReservations.reservationConfirmedAt} is null`
                )
              )
              .returning({ id: workspaceReservations.id });
            yield* ensureUpdated(
              updated,
              "workspaceReservations.markCancelled",
              input.id,
              "Only an unpaid reservation still cancelling under the claim can be marked cancelled."
            );
          }
        ),
        markAdministrationCancelled: Effect.fn(
          "workspaceReservations.markAdministrationCancelled"
        )(function* (input) {
          const cancellation = transaction(
            Effect.gen(function* () {
              const updatedAt = Temporal.Now.instant();
              const updated = yield* db
                .update(workspaceReservations)
                .set({
                  reservationState: "cancelled",
                  reservationCancelledAt: input.cancelledAt,
                  failureCode: input.failureCode,
                  updatedAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.id),
                    eq(workspaceReservations.reservationState, "cancelling"),
                    eq(workspaceReservations.updatedAt, input.claimedAt)
                  )
                )
                .returning({
                  id: workspaceReservations.id,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                  reservationConfirmedAt:
                    workspaceReservations.reservationConfirmedAt,
                });
              yield* ensureUpdated(
                updated,
                "workspaceReservations.markAdministrationCancelled",
                input.id,
                "Only an operator-cancelled reservation can be marked cancelled."
              );
              const [cancelled] = updated;
              // Only a booked reservation's cancellation is a customer event;
              // an unconfirmed one was never booked.
              if (cancelled?.reservationConfirmedAt) {
                yield* recordCustomerEvent({
                  kind: "reservation-cancelled",
                  occurredAt: input.cancelledAt,
                  dotyposCustomerId: cancelled.dotyposCustomerId,
                  workspaceReservationId: input.id,
                });
              }
              yield* db
                .update(paymentAttempts)
                .set({ refundState: "required", updatedAt })
                .where(
                  and(
                    eq(paymentAttempts.workspaceReservationId, input.id),
                    eq(paymentAttempts.provider, "nexi"),
                    eq(paymentAttempts.state, "paid"),
                    // A refund Nexi already reported stays recorded.
                    eq(paymentAttempts.refundState, "not_required")
                  )
                );
            })
          );
          yield* cancellation;
        }),
        completeSupersessionAndCreateDraft: Effect.fn(
          "workspaceReservations.completeSupersessionAndCreateDraft"
        )(function* (input) {
          const supersession = transaction(
            Effect.gen(function* () {
              const [cancelled] = yield* db
                .update(workspaceReservations)
                .set({
                  reservationState: "cancelled",
                  reservationCancelledAt: input.cancelledAt,
                  updatedAt: input.cancelledAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.cancelledReservationId),
                    eq(workspaceReservations.reservationState, "cancelling"),
                    sql`${workspaceReservations.paymentState} <> 'pending'`,
                    sql`${workspaceReservations.paymentState} <> 'paid'`,
                    sql`${workspaceReservations.reservationConfirmedAt} is null`
                  )
                )
                .returning({ id: workspaceReservations.id });

              if (!cancelled) {
                return yield* new WorkspaceReservationStateError({
                  operation:
                    "workspaceReservations.completeSupersessionAndCreateDraft",
                  reservationId: input.cancelledReservationId,
                  message:
                    "Only an unpaid supersession cancellation can create its replacement.",
                });
              }

              const [replacement] = yield* db
                .insert(workspaceReservations)
                .values({
                  id: postgresUuidV7,
                  checkoutSessionKey: input.replacement.checkoutSessionKey,
                  checkoutAttemptKey: input.replacement.checkoutAttemptKey,
                  correlationId: postgresUuidV7,
                  dotyposCustomerId: input.replacement.dotyposCustomerId,
                  authorAccountId: input.replacement.authorAccountId,
                  agentClientId: input.replacement.agentClientId ?? null,
                  agentSelectionKey:
                    input.replacement.agentSelectionKey ?? null,
                  reservationPurpose: input.replacement.reservationPurpose,
                  reservationState: "draft",
                  paymentState: "not_started",
                  fulfillmentState: "not_started",
                  reservationDetails: yield* StoredReservationDetails.encode(
                    input.replacement.reservationDetails
                  ),
                  locale: input.replacement.locale,
                  reservationHoldExpiresAt:
                    input.replacement.reservationHoldExpiresAt,
                })
                .returning();

              if (!replacement) {
                return yield* Effect.die(
                  "Workspace replacement reservation insert returned no row."
                );
              }

              return replacement;
            })
          );

          return yield* supersession.pipe(
            Effect.flatMap(decodeWorkspaceReservation)
          );
        }),
        markCancellationFailed: Effect.fn(
          "workspaceReservations.markCancellationFailed"
        )(function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancellation_failed",
              failureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "cancelling"),
                eq(workspaceReservations.updatedAt, input.claimedAt),
                sql`${workspaceReservations.paymentState} <> 'paid'`
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markCancellationFailed",
            input.id,
            "Only an unpaid reservation still cancelling under the claim can be marked failed."
          );
        }),
        markAdministrationRestored: Effect.fn(
          "workspaceReservations.markAdministrationRestored"
        )(
          function* (input) {
            const { db } = yield* WorkspaceTransaction;
            const [restored] = yield* db
              .update(workspaceReservations)
              .set({
                reservationState: "confirmed",
                reservationCancelledAt: null,
                cancellationCause: null,
                cancellationEmailSentAt: null,
                updatedAt: input.restoredAt,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "cancelled"),
                  eq(
                    workspaceReservations.reservationCancelledAt,
                    input.cancelledAt
                  ),
                  or(
                    isNull(workspaceReservations.cancellationCause),
                    eq(workspaceReservations.cancellationCause, "operator")
                  ),
                  eq(workspaceReservations.paymentState, "paid"),
                  isNotNull(workspaceReservations.reservationConfirmedAt),
                  isNull(workspaceReservations.reservationHoldExpiredAt),
                  isNull(workspaceReservations.failureCode),
                  sql`trim(${workspaceReservations.dotyposReservationId}) <> ''`
                )
              )
              .returning()
              .pipe(
                Effect.mapError((cause) =>
                  isActiveSessionTaken(cause)
                    ? new WorkspaceReservationSessionTakenError({
                        reservationId: input.id,
                        message:
                          "Another reservation of the checkout session is active.",
                      })
                    : cause
                )
              );
            if (!restored) return null;

            // Refunds Nexi already recorded stay as they are.
            yield* db
              .update(paymentAttempts)
              .set({ refundState: "not_required", updatedAt: input.restoredAt })
              .where(
                and(
                  eq(paymentAttempts.workspaceReservationId, input.id),
                  eq(paymentAttempts.refundState, "required")
                )
              );
            const attempts = yield* db
              .select({
                amountExponent: paymentAttempts.amountExponent,
                amountValue: paymentAttempts.amountValue,
                currency: paymentAttempts.currency,
                refundState: paymentAttempts.refundState,
                refundedAmountValue: paymentAttempts.refundedAmountValue,
                state: paymentAttempts.state,
              })
              .from(paymentAttempts)
              .where(eq(paymentAttempts.workspaceReservationId, input.id))
              .orderBy(asc(paymentAttempts.createdAt), asc(paymentAttempts.id));
            return {
              reservation: yield* decodeWorkspaceReservation(restored),
              paymentAttempts: attempts,
            };
          },
          (effect, input) =>
            effect.pipe(Effect.annotateLogs({ reservationId: input.id }))
        ),
        recordCancellationEmailSent: Effect.fn(
          "workspaceReservations.recordCancellationEmailSent"
        )(
          function* (input) {
            // Bookkeeping: the row's revision stays as it is.
            const updated = yield* db
              .update(workspaceReservations)
              .set({ cancellationEmailSentAt: input.sentAt })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "cancelled"),
                  eq(
                    workspaceReservations.reservationCancelledAt,
                    input.cancelledAt
                  )
                )
              )
              .returning({ id: workspaceReservations.id });
            return updated.length > 0;
          },
          (effect, input) =>
            effect.pipe(Effect.annotateLogs({ reservationId: input.id }))
        ),
        // Only a booked reservation's cancellation records the event
        // (markAdministrationCancelled, and the capture reconciler, both
        // require reservation_confirmed_at). Once confirmed, a row never
        // returns to `held`, so its active payment attempt, the paid one,
        // never changes, and a paid attempt never becomes failed, cancelled
        // or expired. Late-payment recovery starts only for such a terminal
        // attempt and settles a non-active one only as a refund, so it never
        // confirms a row with this event; only a restore does.
        hasRecordedCancellation: Effect.fn(
          "workspaceReservations.hasRecordedCancellation"
        )(
          function* (id) {
            const [event] = yield* db
              .select({ id: customerEvents.id })
              .from(customerEvents)
              .where(
                and(
                  eq(customerEvents.kind, "reservation-cancelled"),
                  eq(customerEvents.workspaceReservationId, id)
                )
              )
              .limit(1)
              .pipe(retryDatabaseRead);
            return event !== undefined;
          },
          (effect, reservationId) =>
            effect.pipe(Effect.annotateLogs({ reservationId }))
        ),
        markAdministrationCancellationFailed: Effect.fn(
          "workspaceReservations.markAdministrationCancellationFailed"
        )(function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancellation_failed",
              failureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "cancelling"),
                eq(workspaceReservations.updatedAt, input.claimedAt)
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markAdministrationCancellationFailed",
            input.id,
            "Workspace reservation was not being cancelled."
          );
        }),
        recordHoldCleanupSkipped: Effect.fn(
          "workspaceReservations.recordHoldCleanupSkipped"
        )(function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationHoldExpiredAt: input.holdExpiredAt,
              failureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "held"),
                sql`${workspaceReservations.paymentState} <> 'paid'`,
                lte(
                  workspaceReservations.reservationHoldExpiresAt,
                  input.holdExpiredAt
                )
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.recordHoldCleanupSkipped",
            input.id,
            "Only unpaid expired held reservations can record skipped cleanup."
          );
        }),
        markReservationConfirmed: Effect.fn(
          "workspaceReservations.markReservationConfirmed"
        )(function* (input) {
          const confirmation = transaction(
            Effect.gen(function* () {
              const updated = yield* db
                .update(workspaceReservations)
                .set({
                  reservationState: "confirmed",
                  reservationConfirmedAt: input.confirmedAt,
                  updatedAt: Temporal.Now.instant(),
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.id),
                    eq(workspaceReservations.reservationState, "held"),
                    eq(workspaceReservations.paymentState, "paid"),
                    eq(workspaceReservations.fulfillmentState, "processing")
                  )
                )
                .returning({
                  id: workspaceReservations.id,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                });
              yield* ensureUpdated(
                updated,
                "workspaceReservations.markReservationConfirmed",
                input.id,
                "Only processing paid held reservations can be marked confirmed."
              );
              const [confirmed] = updated;
              if (confirmed) {
                yield* recordCustomerEvent({
                  kind: "reservation-booked",
                  occurredAt: input.confirmedAt,
                  dotyposCustomerId: confirmed.dotyposCustomerId,
                  workspaceReservationId: input.id,
                });
              }
            })
          );
          yield* confirmation;
        }),
        selectExpiredHolds: Effect.fn(
          "workspaceReservations.selectExpiredHolds"
        )(
          function* (input) {
            const reservations = yield* db
              .select()
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.reservationState, "held"),
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  lte(workspaceReservations.reservationHoldExpiresAt, input.now)
                )
              )
              .orderBy(
                sql`coalesce(${workspaceReservations.reservationHoldExpiredAt}, ${workspaceReservations.reservationHoldExpiresAt})`,
                asc(workspaceReservations.reservationHoldExpiresAt),
                asc(workspaceReservations.id)
              )
              .limit(input.limit)
              .pipe(retryDatabaseRead);
            return yield* Effect.forEach(
              reservations,
              decodeWorkspaceReservation
            );
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),
        selectExpiredHoldDotyposReservationIds: Effect.fn(
          "workspaceReservations.selectExpiredHoldDotyposReservationIds"
        )(function* (input) {
          const rows = yield* db
            .select({
              dotyposReservationId: workspaceReservations.dotyposReservationId,
            })
            .from(workspaceReservations)
            .where(
              and(
                eq(workspaceReservations.reservationState, "held"),
                inArray(workspaceReservations.paymentState, [
                  "not_started",
                  "failed",
                  "cancelled",
                  "expired",
                ]),
                sql`${workspaceReservations.dotyposReservationId} is not null`,
                lte(workspaceReservations.reservationHoldExpiresAt, input.now)
              )
            );

          return rows.flatMap(({ dotyposReservationId }) =>
            dotyposReservationId ? [dotyposReservationId] : []
          );
        }),
        listForCustomer: Effect.fn("workspaceReservations.listForCustomer")(
          function* (input) {
            const rows = yield* db
              .select({
                id: workspaceReservations.id,
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                reservationPurpose: workspaceReservations.reservationPurpose,
                reservationState: workspaceReservations.reservationState,
                paymentState: workspaceReservations.paymentState,
                fulfillmentState: workspaceReservations.fulfillmentState,
                locale: workspaceReservations.locale,
                reservationDetails: workspaceReservations.reservationDetails,
                reservationCreatedAt:
                  workspaceReservations.reservationCreatedAt,
                reservationConfirmedAt:
                  workspaceReservations.reservationConfirmedAt,
                reservationCancelledAt:
                  workspaceReservations.reservationCancelledAt,
                paidAt: workspaceReservations.paidAt,
                fulfilledAt: workspaceReservations.fulfilledAt,
              })
              .from(workspaceReservations)
              .where(
                eq(
                  workspaceReservations.dotyposCustomerId,
                  input.dotyposCustomerId
                )
              )
              .orderBy(
                asc(workspaceReservations.createdAt),
                asc(workspaceReservations.id)
              )
              .limit(readLimitSentinel(input.limit))
              .pipe(retryDatabaseRead);
            const bounded = yield* requireWithinReadLimit(rows, input.limit);
            const decoded = yield* StoredReservationDetails.decodeRows(bounded);
            return decoded.map(
              ({
                reservationDetails,
                ...record
              }): CustomerReservationRecord => ({
                ...record,
                product: reservationDetails,
              })
            );
          },
          (effect, { dotyposCustomerId, limit }) =>
            effect.pipe(Effect.annotateLogs({ dotyposCustomerId, limit }))
        ),
      } satisfies IWorkspaceReservationRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

export const decodeOptionalWorkspaceReservation = (
  reservation: WorkspaceReservationRow | undefined
) =>
  reservation ? decodeWorkspaceReservation(reservation) : Effect.succeed(null);

const decodeWorkspaceReservation = (reservation: WorkspaceReservationRow) =>
  StoredReservationDetails.decodeRow(reservation).pipe(
    Effect.map(withReservationKindFields)
  );
