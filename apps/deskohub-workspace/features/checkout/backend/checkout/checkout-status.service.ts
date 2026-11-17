import type { DotyposCustomer } from "@deskohub/dotypos";
import {
  type DotyposReservationId,
  DotyposService,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Clock, Context, Duration, Effect, Layer, Match, Option } from "effect";
import {
  WorkspaceDatabase,
  workspaceStatementConcurrency,
} from "@/db/database.service";
import type { FulfillmentState, PaymentState } from "@/db/schema";
import { checkoutStatusTraits } from "@/features/checkout/checkout-status-kind";
import { getPaymentAttemptAbandonmentCutoff } from "@/features/checkout/provider-order-abandonment";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import {
  type BookedReservation,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import {
  getStoredRebookingSelection,
  type RebookingSelection,
} from "@/features/reservation/backend/booking-selection";
import {
  type CustomerReservationPlacement,
  getCustomerReservationPlacement,
} from "@/features/reservation/backend/customer-reservation-placement";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { SeatingMapReleaseGate } from "@/features/reservation/backend/seating-map-release-gate";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationTiming } from "@/features/reservation/backend/workspace-reservation.service";
import { getBookedSelection } from "@/features/reservation/booked-selection";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { StoredMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { StoredOfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationSelection } from "@/features/reservation/selection-path";
import { ReviewSandbox } from "@/features/review-accounts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { nexiRequestTimeout } from "@/shared/backend/config/nexi.config";
import type { Money } from "@/shared/money/money";
import { currentInstant } from "@/shared/utils/temporal";
import { LatePaymentVerificationService } from "../payment/late-payment-verification.service";
import {
  type ProviderPaymentFinalizationResult,
  ProviderPaymentFinalizationService,
  providerPaymentFinalizationLogFields,
} from "../payment/provider-payment-finalization.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import type { PaymentLifecycleRepositoryError } from "../repositories/payment-lifecycle.repository";
import {
  type CheckoutReservationStatusKind,
  getLatePaymentStatusKind,
  toCheckoutStatusKind,
} from "./checkout-reservation-status-kind";
import {
  type PaymentPageProviderObservation,
  PaymentPageProviderStatus,
} from "./payment-page-provider-status";
import {
  decidePaymentPageReopening,
  getPaymentPageToReopen,
} from "./reusable-payment-attempt";

export type CheckoutStatusReturnOutcome = "success" | "cancelled" | "unknown";

type CheckoutStatusSummaryBase = {
  readonly price: Money;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
};

export type CheckoutCoworkStatusSummary = CheckoutStatusSummaryBase &
  StoredCoworkReservationDetails;

export type CheckoutMeetingRoomStatusSummary = CheckoutStatusSummaryBase &
  StoredMeetingRoomReservationDetails & {
    /**
     * When an early-setup meeting room is held from, before `reservedFrom`.
     * The customer may arrive then.
     */
    readonly setupFrom?: Temporal.Instant;
  };

export type CheckoutOfficeStatusSummary = CheckoutStatusSummaryBase &
  StoredOfficeReservationDetails & { readonly seats: number };

type CheckoutStatusContactPrefill = {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
};

type CheckoutStatusViewModelBase = {
  readonly orderId: WorkspaceReservationId;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
};

type CheckoutReservationStatusViewModelBase = CheckoutStatusViewModelBase &
  CustomerReservationPlacement & {
    readonly status: CheckoutReservationStatusKind;
    readonly paymentStatus: PaymentState;
    readonly fulfillmentStatus: FulfillmentState;
    readonly supportContactPrefill?: CheckoutStatusContactPrefill;
    /** The booked selection a retry status reopens on the reservation page. */
    readonly retrySelection?: ReservationSelection;
    /**
     * Marks a pending payment whose stored payment page may still be opened
     * again: inside its reopening window, which ends before the provider
     * cancels an abandoned page.
     */
    readonly paymentPageReopenable?: true;
    /**
     * What booking the order's reservation again sends, read from the same
     * stored details and Dotypos reservation as the summary.
     */
    readonly bookedSelection?: RebookingSelection;
    /**
     * Marks a review account's sample or simulated hold, which nothing was
     * reserved or charged for and which has no access code.
     */
    readonly reviewSandbox?: true;
  };

type CheckoutCoworkStatusViewModel = CheckoutReservationStatusViewModelBase & {
  readonly kind: "cowork";
  readonly summary?: CheckoutCoworkStatusSummary;
};

type CheckoutMeetingRoomStatusViewModel =
  CheckoutReservationStatusViewModelBase & {
    readonly kind: "meeting-room";
    readonly summary?: CheckoutMeetingRoomStatusSummary;
  };

type CheckoutOfficeStatusViewModel = CheckoutReservationStatusViewModelBase & {
  readonly kind: "office";
  readonly summary?: CheckoutOfficeStatusSummary;
};

type CheckoutStatusNotFoundViewModel = CheckoutStatusViewModelBase & {
  readonly status: "not_found";
  readonly summary?: undefined;
};

type CheckoutReservationStatusViewModel =
  | CheckoutCoworkStatusViewModel
  | CheckoutMeetingRoomStatusViewModel
  | CheckoutOfficeStatusViewModel;

export type CheckoutStatusViewModel =
  | CheckoutReservationStatusViewModel
  | CheckoutStatusNotFoundViewModel;

type CheckoutStatusReservationReconstruction =
  | {
      readonly kind: "cowork";
      readonly summary?: CheckoutCoworkStatusSummary;
    }
  | {
      readonly kind: "meeting-room";
      readonly summary?: CheckoutMeetingRoomStatusSummary;
    }
  | {
      readonly kind: "office";
      readonly summary?: CheckoutOfficeStatusSummary;
    };

type CheckoutStatusReconstruction = {
  readonly reservation: CheckoutStatusReservationReconstruction;
  readonly placement?: CustomerReservationPlacement;
  readonly bookedSelection?: RebookingSelection;
};

type CheckoutStatusError =
  | EffectDrizzleQueryError
  | PaymentLifecycleRepositoryError
  | WorkspaceReservationDetailsMalformedError;

type CheckoutStatusLookup = {
  readonly orderId: WorkspaceReservationId;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  /**
   * Whether to read the customer's contact details from Dotypos for the
   * statuses that show them. Defaults to true; a caller that never shows them
   * passes false to skip the read.
   */
  readonly includeSupportContact?: boolean;
};

export interface ICheckoutStatusService {
  readonly getStatus: (
    input: CheckoutStatusLookup
  ) => Effect.Effect<CheckoutStatusViewModel, CheckoutStatusError>;
  readonly refreshStatus: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, CheckoutStatusError>;
}

const canUseAttemptForSummary = (
  attempt: PaymentAttempt,
  reservation: WorkspaceReservation
) => {
  if (
    attempt.id === reservation.activePaymentAttemptId &&
    ["created", "pending", "paid"].includes(attempt.state)
  ) {
    return true;
  }

  return reservation.paymentState === "paid" && attempt.state === "paid";
};

/** Payment states that ended without settling, which the customer may retry. */
const isRetryablePaymentState = (paymentState: PaymentState) =>
  paymentState === "failed" ||
  paymentState === "cancelled" ||
  paymentState === "expired";

/** The Dotypos reservation a retry reopens, for a payment that ended unpaid. */
const getRetryDotyposReservationId = (reservation: WorkspaceReservation) =>
  Option.fromNullishOr(reservation.dotyposReservationId).pipe(
    Option.filter(() => isRetryablePaymentState(reservation.paymentState))
  );

/**
 * Payment states whose displayable attempt is normally usable, so the Dotypos
 * reservation can load alongside the attempt instead of after it.
 */
const isSummaryLikelyDisplayable = (reservation: WorkspaceReservation) =>
  reservation.paymentState === "not_started" ||
  reservation.paymentState === "pending" ||
  reservation.paymentState === "paid";

const toOptionalString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const getSupportContactPrefill = (
  customer: DotyposCustomer
): CheckoutStatusContactPrefill | undefined => {
  const prefill: CheckoutStatusContactPrefill = {
    name: getCustomerDisplayName(customer),
    email: toOptionalString(customer.email),
    phone: toOptionalString(customer.phone),
  };

  return prefill.name || prefill.email || prefill.phone ? prefill : undefined;
};

const getEmptyCheckoutStatusReservation = (
  details: WorkspaceReservation["reservationDetails"]
): CheckoutStatusReservationReconstruction =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => ({ kind: "cowork" as const }),
      "meeting-room": () => ({ kind: "meeting-room" as const }),
      office: () => ({ kind: "office" as const }),
    })
  );

/** The family's summary of the booked time and the paid attempt's amount. */
const toStatusReservation = ({
  reservation,
  booked,
  timing,
  attempt,
}: {
  readonly reservation: WorkspaceReservation;
  readonly booked: Pick<BookedReservation, "seats" | "setupStart">;
  readonly timing: Effect.Success<
    ReturnType<typeof getDotyposReservationTiming>
  >;
  readonly attempt: Pick<PaymentAttempt, "amount">;
}): CheckoutStatusReservationReconstruction =>
  Match.value(reservation.reservationDetails).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (details) => ({
        kind: "cowork" as const,
        summary: {
          ...details,
          ...timing,
          price: attempt.amount,
        },
      }),
      "meeting-room": (details) => ({
        kind: "meeting-room" as const,
        summary: {
          ...details,
          ...timing,
          ...Option.match(booked.setupStart, {
            onNone: () => ({}),
            onSome: (setupFrom) => ({ setupFrom }),
          }),
          price: attempt.amount,
        },
      }),
      office: (details) => {
        // Unreadable Dotypos seats leave the office summary out.
        if (Option.isNone(booked.seats)) return { kind: "office" as const };
        const seats = booked.seats.value;

        return {
          kind: "office" as const,
          summary: {
            ...details,
            ...timing,
            price: attempt.amount,
            seats,
          },
        };
      },
    })
  );

const summaryTimeout = "8 seconds";

/**
 * Bounds all Nexi payment verification in one status refresh, retries
 * included. It fits one full sandbox-length Nexi request and leaves time, with
 * the 8-second summary cap, to render the stored status within the status
 * page's 60-second `maxDuration`. Production lookups (5 seconds each) keep
 * their usual retries.
 */
const refreshVerificationBudget = Duration.seconds(40);

/**
 * What a refresh's verification read of the active attempt's provider order,
 * for its payment page; nothing when it didn't read a pending order.
 */
const refreshedPaymentPageObservation = (
  result: ProviderPaymentFinalizationResult
): PaymentPageProviderObservation | undefined => {
  if (result === "awaiting_payment") return "no_activity";
  if (result === "pending") return "activity";
  if (result === "provider_verification_failed") return "unknown";
  return undefined;
};

const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const reviewSandbox = yield* ReviewSandbox;
  const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;
  const latePaymentVerification = yield* LatePaymentVerificationService;
  const paymentAttempts = yield* PaymentAttemptRepository;
  const paymentPageProviderStatus = yield* PaymentPageProviderStatus;
  const dotypos = yield* DotyposService;
  const records = yield* ReservationRecords;
  const inventory = yield* AdvisoryAvailabilityInventory;
  const finalization = yield* ProviderPaymentFinalizationService;
  const seatingMap = yield* SeatingMapReleaseGate;

  /**
   * Loads what the summary needs at once: the displayable payment attempt, the
   * Dotypos reservation when the attempt is likely usable, the table
   * inventory, and the seating-map release.
   */
  const loadSummarySources = (input: {
    readonly reservation: WorkspaceReservation;
    readonly loadDotyposReservation: Effect.Effect<
      ReservationRecord | undefined
    >;
    readonly prefetchDotyposReservation: boolean;
  }) =>
    Effect.flatMap(workspaceStatementConcurrency, (concurrency) =>
      Effect.all(
        [
          paymentAttempts.findDisplayableForReservation({
            workspaceReservationId: input.reservation.id,
            activePaymentAttemptId:
              input.reservation.activePaymentAttemptId ?? undefined,
            paymentState: input.reservation.paymentState,
          }),
          input.prefetchDotyposReservation
            ? input.loadDotyposReservation
            : Effect.void,
          inventory.tables.pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Checkout status tables load failed", {
                cause,
              })
            ),
            Effect.orElseSucceed(() => [])
          ),
          seatingMap.isOpen,
        ],
        { concurrency }
      )
    );

  const reconstructSummary = Effect.fn(
    "CheckoutStatusService.reconstructSummary"
  )(
    function* (reservation: WorkspaceReservation) {
      yield* Effect.logDebug("Checkout status summary reconstruction started");
      const emptyReconstruction: CheckoutStatusReconstruction = {
        reservation: getEmptyCheckoutStatusReservation(
          reservation.reservationDetails
        ),
      };

      if (!reservation.dotyposReservationId) {
        yield* Effect.logWarning(
          "Checkout status summary missing Dotypos reservation id"
        );
        return emptyReconstruction;
      }

      const dotyposReservationId = reservation.dotyposReservationId;
      const loadDotyposReservation = Effect.suspend(() =>
        records.get(dotyposReservationId)
      ).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Checkout status summary reservation load failed", {
            cause,
          })
        ),
        Effect.orElseSucceed(() => undefined)
      );
      const prefetchDotyposReservation =
        isSummaryLikelyDisplayable(reservation);

      const [attempt, prefetchedDotyposReservation, tables, seatingMapEnabled] =
        yield* loadSummarySources({
          reservation,
          loadDotyposReservation,
          prefetchDotyposReservation,
        });
      yield* Effect.logDebug(
        "Checkout status summary attempt lookup completed"
      );

      if (!attempt) {
        yield* Effect.logWarning(
          "Checkout status summary missing payment attempt"
        );
        return emptyReconstruction;
      }
      yield* Effect.annotateLogsScoped({
        paymentAttemptId: attempt.id,
        paymentAttemptState: attempt.state,
      });

      if (!canUseAttemptForSummary(attempt, reservation)) {
        yield* Effect.logWarning(
          "Checkout status summary unusable payment attempt"
        );
        return emptyReconstruction;
      }

      const dotyposReservation = prefetchDotyposReservation
        ? prefetchedDotyposReservation
        : yield* loadDotyposReservation;

      if (!dotyposReservation) {
        yield* Effect.logWarning(
          "Checkout status summary missing Dotypos reservation"
        );
        return emptyReconstruction;
      }
      yield* Effect.logDebug(
        "Checkout status summary Dotypos reservation loaded"
      );

      const placement = getCustomerReservationPlacement({
        reservationDetails: reservation.reservationDetails,
        dotyposReservation,
        tables,
        seatingMap: seatingMapEnabled,
      });

      const booked = decodeBookedReservation(
        dotyposReservation,
        reservation.reservationDetails
      );
      const timing = yield* getDotyposReservationTiming({
        reservationId: reservation.id,
        reservation: booked,
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning(
            "Checkout status summary reservation timing invalid",
            { cause }
          )
        ),
        Effect.orElseSucceed(() => undefined)
      );

      if (!timing) {
        const reconstruction: CheckoutStatusReconstruction = {
          reservation: emptyReconstruction.reservation,
          placement,
        };

        return reconstruction;
      }

      const statusReservation = toStatusReservation({
        reservation,
        booked,
        timing,
        attempt,
      });
      const bookedSelection = getStoredRebookingSelection({
        details: reservation.reservationDetails,
        booked,
        timing,
      });

      yield* Effect.logDebug("Checkout status summary reconstructed");

      const reconstruction: CheckoutStatusReconstruction = {
        reservation: statusReservation,
        placement,
        ...(bookedSelection && { bookedSelection }),
      };

      return reconstruction;
    },
    (effect, reservation) =>
      effect.pipe(
        Effect.scoped,
        Effect.annotateLogs({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          reservationKind: reservation.reservationDetails.kind,
        })
      )
  );

  /**
   * Loads the support contact prefill for statuses that show it. Best
   * effort: the status renders without a prefill when Dotypos is slow.
   */
  const loadSupportContactPrefill = Effect.fn(
    "CheckoutStatusService.loadSupportContactPrefill"
  )(function* (
    reservation: WorkspaceReservation,
    statusKind: CheckoutReservationStatusKind
  ) {
    if (!checkoutStatusTraits[statusKind].showsCustomerContact)
      return undefined;

    return yield* dotypos.getCustomer(reservation.dotyposCustomerId).pipe(
      Effect.map(
        Option.match({
          onNone: () => undefined,
          onSome: getSupportContactPrefill,
        })
      ),
      Effect.timeoutOrElse({
        duration: summaryTimeout,
        orElse: () => Effect.undefined,
      }),
      Effect.tapError((cause) =>
        Effect.logWarning("Checkout status support contact load failed", {
          cause,
        })
      ),
      Effect.orElseSucceed(() => undefined)
    );
  });

  /**
   * The booked selection of a payment that ended without settling, which a
   * retry's reservation-page link reopens. The interval comes from
   * the Dotypos reservation, which stays readable after hold cleanup cancels
   * it. Best effort: without it the page starts a plain new reservation.
   */
  const loadRetrySelection = Effect.fn(
    "CheckoutStatusService.loadRetrySelection"
  )(
    (input: {
      readonly reservation: WorkspaceReservation;
      readonly dotyposReservationId: DotyposReservationId;
    }) =>
      Effect.succeed(input).pipe(
        Effect.bind("booked", ({ dotyposReservationId, reservation }) =>
          records
            .get(dotyposReservationId)
            .pipe(
              Effect.map((record) =>
                decodeBookedReservation(record, reservation.reservationDetails)
              )
            )
        ),
        Effect.bind("timing", ({ reservation, booked }) =>
          getDotyposReservationTiming({
            reservationId: reservation.id,
            reservation: booked,
          })
        ),
        Effect.map(({ reservation, booked, timing }) =>
          getBookedSelection({
            details: reservation.reservationDetails,
            booked,
            timing,
          })
        ),
        Effect.timeoutOrElse({
          duration: summaryTimeout,
          orElse: () =>
            Effect.logWarning(
              "Checkout status retry selection load timed out"
            ).pipe(Effect.as(undefined)),
        }),
        Effect.tapError((cause) =>
          Effect.logWarning("Checkout status retry selection load failed", {
            cause,
          })
        ),
        Effect.orElseSucceed(() => undefined)
      ),
    (effect, { reservation }) =>
      effect.pipe(
        Effect.annotateLogs({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          reservationKind: reservation.reservationDetails.kind,
        })
      )
  );

  /** Loads the retry selection only for a payment the customer may retry. */
  const loadOfferedRetrySelection = (reservation: WorkspaceReservation) =>
    Option.match(getRetryDotyposReservationId(reservation), {
      onNone: () => Effect.undefined,
      onSome: (dotyposReservationId) =>
        loadRetrySelection({ reservation, dotyposReservationId }),
    });

  /**
   * A provider payment unsettled past the abandonment cutoff may never settle,
   * so the page stops promising confirmation and offers support. Hold
   * cleanup later expires an empty order, which then allows a new booking.
   * Its stored payment page is offered again while the provider's order
   * shows no activity (`refreshed` when the refresh just read it, else one
   * bounded lookup), and within the provisional reopening window when the
   * provider can't be asked.
   */
  const getPendingPaymentTiming = Effect.fn(
    "CheckoutStatusService.getPendingPaymentTiming"
  )(function* (
    reservation: WorkspaceReservation,
    now: Temporal.Instant,
    refreshed: PaymentPageProviderObservation | undefined
  ) {
    const unknown = { overdue: false, paymentPageReopenable: false };
    if (!reservation.activePaymentAttemptId) return unknown;

    const attempt = yield* paymentAttempts.findById(
      reservation.activePaymentAttemptId
    );
    if (!attempt) return unknown;

    return {
      overdue:
        Temporal.Instant.compare(
          now,
          getPaymentAttemptAbandonmentCutoff(attempt)
        ) >= 0,
      paymentPageReopenable: yield* isPaymentPageReopenable(
        reservation,
        attempt,
        now,
        refreshed
      ),
    };
  });

  const isPaymentPageReopenable = Effect.fnUntraced(function* (
    reservation: WorkspaceReservation,
    attempt: PaymentAttempt,
    now: Temporal.Instant,
    refreshed: PaymentPageProviderObservation | undefined
  ) {
    if ("closed" in getPaymentPageToReopen(attempt, now)) return false;
    const observation =
      refreshed ??
      (yield* paymentPageProviderStatus.observe({ attempt, reservation }));
    // The provider may answer after the abandonment cutoff passed.
    const answeredAt = refreshed ? now : yield* currentInstant;
    return (
      decidePaymentPageReopening(attempt, answeredAt, observation) === "open"
    );
  });

  /** Derives the customer status and its support contact prefill. */
  const resolveStatusKind = Effect.fn(
    "CheckoutStatusService.resolveStatusKind"
  )(function* (
    reservation: WorkspaceReservation,
    includeSupportContact: boolean,
    refreshed: PaymentPageProviderObservation | undefined
  ) {
    const latePaymentRecovery =
      yield* latePaymentRecoveries.findLatestByWorkspaceReservationId(
        reservation.id
      );
    const latePaymentStatusKind = getLatePaymentStatusKind(
      reservation,
      latePaymentRecovery
    );
    const now = yield* currentInstant;
    const reservationStatusKind = toCheckoutStatusKind(reservation, now);
    const pendingPaymentTiming =
      !latePaymentStatusKind && reservationStatusKind === "pending"
        ? yield* getPendingPaymentTiming(reservation, now, refreshed)
        : undefined;
    const statusKind =
      latePaymentStatusKind ??
      (pendingPaymentTiming?.overdue
        ? "payment_pending_delayed"
        : reservationStatusKind);
    const paymentPageReopenable =
      statusKind === "pending" &&
      pendingPaymentTiming?.paymentPageReopenable === true;
    const supportContactPrefill = includeSupportContact
      ? yield* loadSupportContactPrefill(reservation, statusKind)
      : undefined;

    return {
      latePaymentStatusKind,
      statusKind,
      paymentPageReopenable,
      supportContactPrefill,
    };
  });

  /**
   * Looks the status up; `refreshed` is what a refresh's verification just
   * read from the provider's order, so the page isn't read twice.
   */
  const lookUpStatus = Effect.fn("CheckoutStatusService.getStatus")(
    function* (
      input: CheckoutStatusLookup,
      refreshed: PaymentPageProviderObservation | undefined
    ) {
      yield* Effect.logInfo("Checkout status lookup started");

      const reservation = yield* reservations.findById(input.orderId);
      yield* Effect.logDebug("Checkout status reservation lookup completed");

      if (!reservation) {
        const result: CheckoutStatusViewModel = Option.getOrElse(
          yield* reviewSandbox.status(input),
          () => ({
            orderId: input.orderId,
            returnOutcome: input.returnOutcome,
            status: "not_found",
          })
        );

        yield* Effect.annotateLogsScoped({ status: result.status });
        yield* Effect.logInfo("Checkout status lookup completed");

        return result;
      }

      const timeoutReconstruction: CheckoutStatusReconstruction = {
        reservation: getEmptyCheckoutStatusReservation(
          reservation.reservationDetails
        ),
      };
      const [
        {
          latePaymentStatusKind,
          statusKind,
          paymentPageReopenable,
          supportContactPrefill,
        },
        reconstruction,
        retrySelection,
      ] = yield* Effect.flatMap(workspaceStatementConcurrency, (concurrency) =>
        Effect.all(
          [
            resolveStatusKind(
              reservation,
              input.includeSupportContact ?? true,
              refreshed
            ),
            reconstructSummary(reservation).pipe(
              Effect.timeoutOrElse({
                duration: summaryTimeout,
                orElse: () =>
                  Effect.logWarning(
                    "Checkout status summary reconstruction timed out",
                    { reservationId: reservation.id }
                  ).pipe(Effect.as(timeoutReconstruction)),
              })
            ),
            loadOfferedRetrySelection(reservation),
          ],
          { concurrency }
        )
      );

      const resultBase: CheckoutReservationStatusViewModelBase = {
        orderId: reservation.id,
        returnOutcome: input.returnOutcome,
        status: statusKind,
        paymentStatus: reservation.paymentState,
        fulfillmentStatus: reservation.fulfillmentState,
        // A late payment has no booked place to show until recovery confirms
        // a reservation; the original hold's table may belong to someone else.
        ...(!latePaymentStatusKind && reconstruction.placement),
        supportContactPrefill,
        ...(paymentPageReopenable && { paymentPageReopenable: true as const }),
        // A late payment that settled takes over the status, and with it the
        // retry of the payment it replaced.
        ...(checkoutStatusTraits[statusKind].offersReservationRetry &&
          retrySelection && { retrySelection }),
        ...(reconstruction.bookedSelection && {
          bookedSelection: reconstruction.bookedSelection,
        }),
      };
      const result: CheckoutReservationStatusViewModel = {
        ...resultBase,
        ...reconstruction.reservation,
      };

      yield* Effect.annotateLogsScoped({
        status: result.status,
        reservationKind: result.kind,
      });
      yield* Effect.logInfo("Checkout status lookup completed");

      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((cause) =>
          Effect.logError("Checkout status lookup failed", { cause })
        ),
        Effect.annotateLogs({ ...input })
      )
  );

  return {
    getStatus: (input: CheckoutStatusLookup) => lookUpStatus(input, undefined),
    refreshStatus: Effect.fn("CheckoutStatusService.refreshStatus")(
      function* (input) {
        yield* Effect.logInfo("Checkout status refresh started");
        const verificationStartedAt = yield* Clock.currentTimeMillis;
        const remainingVerificationBudget = Clock.currentTimeMillis.pipe(
          Effect.map((now) =>
            Duration.max(
              Duration.subtract(
                refreshVerificationBudget,
                Duration.millis(now - verificationStartedAt)
              ),
              Duration.zero
            )
          )
        );

        // Finalization loads the reservation and resolves its active attempt;
        // an order without one returns not_found and renders as stored.
        const result = yield* finalization.finalizePendingProviderPayment({
          orderId: input.orderId,
          verificationDeadline: refreshVerificationBudget,
        });
        yield* Effect.annotateLogsScoped(
          providerPaymentFinalizationLogFields(result)
        );
        yield* Effect.logInfo("Checkout status refresh finalization completed");

        if (result === "not_pending") {
          // A slow finalization lookup can lose a race with a concurrent
          // terminal transition. Start the late-payment lookup only when one
          // full Nexi request still fits the shared budget; otherwise the
          // success notification or a later refresh verifies it.
          const remaining = yield* remainingVerificationBudget;
          if (Duration.isLessThan(remaining, nexiRequestTimeout)) {
            yield* Effect.logWarning(
              "Checkout status refresh deferred late-payment verification",
              { remainingMilliseconds: Duration.toMillis(remaining) }
            );
          } else {
            const latePayment =
              yield* latePaymentVerification.startRecoveryIfSettled({
                orderId: input.orderId,
                verificationDeadline: remaining,
              });
            yield* Effect.annotateLogsScoped({ latePayment });
          }
        }

        if (result !== "terminal") {
          const level =
            result === "not_verifiable" || result === "verification_mismatch"
              ? "Warn"
              : "Info";
          yield* Effect.logWithLevel(level)(
            "Checkout status refresh finalization returned non-terminal",
            { result }
          );
        }

        const status = yield* lookUpStatus(
          input,
          refreshedPaymentPageObservation(result)
        );
        yield* Effect.annotateLogsScoped(
          Match.value(status).pipe(
            Match.when({ status: "not_found" }, ({ status }) => ({ status })),
            Match.orElse(({ kind, status }) => ({
              status,
              reservationKind: kind,
            }))
          )
        );
        yield* Effect.logInfo("Checkout status refresh completed");

        return status;
      },
      (effect, input) =>
        effect.pipe(
          Effect.scoped,
          Effect.tapError((cause) =>
            Effect.logError("Checkout status refresh failed", { cause })
          ),
          Effect.annotateLogs({ ...input })
        )
    ),
  };
});

export class CheckoutStatusService extends Context.Service<
  CheckoutStatusService,
  ICheckoutStatusService
>()("@deskohub-workspace/checkout/CheckoutStatusService") {
  static Default = Layer.effect(this, implementation);

  /**
   * The status service wired to read reservation details from `records`:
   * live for the status page, shared snapshots for customers' AI agents.
   */
  static withRecords = <E>(records: Layer.Layer<ReservationRecords, E>) =>
    this.Default.pipe(
      Layer.provide(records),
      Layer.provide(ProviderPaymentFinalizationService.Live),
      Layer.provide(PaymentPageProviderStatus.Live),
      Layer.provide(LatePaymentVerificationService.Live),
      Layer.provide(LatePaymentRecoveryRepository.Default),
      Layer.provide(PaymentAttemptRepository.Default),
      Layer.provide(WorkspaceReservationRepository.Default),
      Layer.provide(ReviewSandbox.Default),
      Layer.provide(WorkspaceDatabase.Default),
      Layer.provide(WorkspaceDotyposLayer),
      Layer.provide(SharedAvailabilityInventoryLive),
      Layer.provide(SeatingMapReleaseGate.Live)
    );

  static Live = this.withRecords(ReservationRecords.Live);
}
