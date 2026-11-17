import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import {
  type HostedPaymentCustomer,
  type NexiCorrelationId,
  type ExternalAPIError as NexiExternalAPIError,
  type NetworkError as NexiNetworkError,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { parsePhoneNumber } from "@deskohub/phone-number";
import { Context, Data, Effect, Layer, Match, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAccountSections } from "@/features/account";
import {
  type AccountingDocumentSnapshot,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import {
  type CheckoutSummary,
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type { PaymentReturnTarget } from "@/features/checkout/payment-return-target";
import {
  isWorkspaceCoworkCurrentProductTier,
  type WorkspaceCoworkProductTier,
} from "@/features/checkout/product-catalog";
import { getCheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import type { DiscountCommitment } from "@/features/discounts";
import { defaultPhoneRegion, type Locale } from "@/features/i18n";
import { isEarlyPerformanceRequestRequired } from "@/features/legal/early-performance";
import { getPaymentSubmitLegalEvidence } from "@/features/legal/payment-submit-evidence";
import {
  reservationLogFields,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationIntervalInput } from "@/features/reservation/cowork-reservation";
import type { CoworkStay } from "@/features/reservation/cowork-stay";
import { hasOfficeReservationEnded } from "@/features/reservation/office-reservation";
import {
  getStoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { type Money, moneyEquals } from "@/shared/money/money";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { localDateTimeToInstant } from "@/shared/utils/temporal";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { NexiAmountFromWorkspaceMoney } from "../payment/nexi-amount.codec";
import { getNexiCurrencyOverride } from "../payment/nexi-currency";
import { getNexiHostedPaymentCustomer } from "../payment/nexi-customer-info";
import { LegalEvidenceEventRepository } from "../repositories/legal-evidence-event.repository";
import {
  isNexiPaymentAttempt,
  type PaymentAttempt,
  PaymentAttemptRepository,
  paymentAttemptLogFields,
} from "../repositories/payment-attempt.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { formatWorkspaceReservationNote } from "../reservation/dotypos-reservation.adapter";
import {
  CheckoutPricingService,
  type PaymentPriceAffirmation,
} from "./checkout-pricing.service";
import { CheckoutUnavailableError } from "./checkout-unavailable";
import {
  type FreshPayState,
  PayState,
  type PayStateReissue,
  type PayStateTokenError,
  type PayStateWithHoldExpiry,
  type SignedPayState,
  toFreshPayState,
} from "./pay-state";
import { type OpenCheckout, PayableCheckout } from "./payable-checkout.service";
import type { PriceVerdict } from "./price-verdict";
import { getReservationStatusPath } from "./reservation-status-url";
import {
  getReusableProviderRedirectUrl,
  isReusableAttemptState,
} from "./reusable-payment-attempt";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

export class CheckoutError extends Data.TaggedError("CheckoutError")<{
  readonly code:
    | "checkout_failed"
    | "meeting_room_reservation_ended"
    | "office_reservation_ended"
    | "cowork_reservation_ended"
    | "cowork_offer_replaced"
    | "legal_consent_required"
    | "early_performance_consent_required";
  readonly message: string;
  readonly cause?: unknown;
}> {}

type CheckoutRedirectResult = {
  readonly status: "redirect";
  readonly orderId: WorkspaceReservationId;
  readonly redirectUrl: string;
  readonly statusUrl?: string;
  /** The order is paid: completed internally or already paid before. */
  readonly paid?: true;
};

/**
 * Exclusive-end guard for cowork days, tier-aware via the reservation
 * domain's shared interval constructor: an Open Space day spans Prague-local
 * 00:00 until 17:00 exclusive on the reserved date, every other tier spans
 * Prague midnight to the next midnight (DST-correct calendar day). A new
 * payment attempt fails once the current instant is at or after the reserved
 * day's exclusive end — exactly at the end included, and always for dates
 * already before the current local date, whose exclusive end is past.
 */
const isCoworkReservationExclusiveEndReached = (input: {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly date: string;
  readonly stay?: CoworkStay;
  readonly now?: Temporal.Instant;
}) => {
  const now = input.now ?? Temporal.Now.instant();
  const exclusiveEnd = localDateTimeToInstant({
    dateTime: getCoworkReservationIntervalInput(
      input.entryTier,
      input.date,
      input.stay
    ).endsAt,
    timeZone: workspaceSiteConstants.location.timeZone,
  });

  return Temporal.Instant.compare(now, exclusiveEnd) >= 0;
};

const ensureReservationHasNotEnded = Effect.fn(
  "checkout.ensureReservationHasNotEnded"
)(function* (reservation: SignedPayState["reservation"]) {
  const error = Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (coworkReservation) => {
        // Old tiers stay decodable for history but are no longer current:
        // in-flight legacy checkouts get no grace path and must restart with
        // the current offers instead of creating a payment attempt at old
        // amounts.
        if (!isWorkspaceCoworkCurrentProductTier(coworkReservation.entryTier)) {
          return new CheckoutError({
            code: "cowork_offer_replaced",
            message:
              "This cowork offer is no longer available. Please start a new reservation with the current offers.",
          });
        }
        // Exclusive-day end: a new payment attempt for an Open Space day
        // fails once the current Prague time is at or after 17:00 on the
        // reserved date, and a Reserved Desk day once it is at or after
        // midnight after the reserved date (noon the next day for an
        // overnight stay) — including reservations whose date is already
        // before the current local date. Idempotent
        // provider-session reuse above is not affected.
        if (isCoworkReservationExclusiveEndReached(coworkReservation)) {
          return new CheckoutError({
            code: "cowork_reservation_ended",
            message:
              coworkReservation.entryTier === "open-space"
                ? "Open Space reservation day has already ended."
                : "Reserved Desk reservation day has already ended.",
          });
        }
        return undefined;
      },
      "meeting-room": (meetingRoomReservation) => {
        if (!hasReservationIntervalEnded(meetingRoomReservation)) return;
        return new CheckoutError({
          code: "meeting_room_reservation_ended",
          message: "Meeting-room reservation has already ended.",
        });
      },
      office: (officeReservation) => {
        if (!hasOfficeReservationEnded(officeReservation)) return;
        return new CheckoutError({
          code: "office_reservation_ended",
          message: "Office reservation has already ended.",
        });
      },
    })
  );
  if (!error) return;

  yield* Effect.logInfo(
    "Hosted payment checkout rejected: reservation already ended"
  );
  return yield* error;
});

export interface ICheckoutService {
  readonly createHostedPaymentCheckout: (
    input: {
      readonly payStateToken: string;
      readonly legalConsent?: boolean;
      readonly earlyPerformanceConsent?: boolean;
      /**
       * The app the hosted payment returns to; none returns to the site's
       * status page.
       */
      readonly returnTarget?: PaymentReturnTarget;
    },
    locale: Locale
  ) => Effect.Effect<
    | CheckoutRedirectResult
    | ({
        readonly status: "pricing_changed";
        readonly changedKeys: ReturnType<typeof getCheckoutSummaryChangedKeys>;
        readonly freshSummary: CheckoutSummary;
      } & FreshPayState)
    | { readonly status: "in_progress" },
    CheckoutError
  >;
}

export class CheckoutService extends Context.Service<
  CheckoutService,
  ICheckoutService
>()("CheckoutService") {
  static Default = makeCheckoutServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(CustomerAccountSections.Live),
    Layer.provide(ReservationFulfillment.Live),
    Layer.provide(PayableCheckout.Default),
    Layer.provide(LegalEvidenceEventRepository.Default),
    Layer.provide(CheckoutAnalytics.Live),
    Layer.provide(PaymentLifecycleRepository.Live),
    Layer.provide(PaymentAttemptRepository.Default),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(WorkspaceNexiLayer),
    Layer.provide(CheckoutPricingService.Live),
    Layer.provide(SealedStateKeys.Default)
  );
}

const generateNexiOrderId = (): NexiOrderId =>
  NexiOrderIdSchema.make(
    `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
      .toString(36)
      .toUpperCase()}`
  );

const toCheckoutUrlError = (cause: WorkspaceUrlConfigError) =>
  Effect.fail(
    new CheckoutError({
      code: "checkout_failed",
      message: cause.message,
      cause,
    })
  );

const getCheckoutPayReturnUrl: (
  locale: Locale,
  workspaceReservationId: WorkspaceReservationId,
  outcome?: "cancelled"
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutPayReturnUrl"
)(
  function* (locale, workspaceReservationId, outcome) {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(
          `/${locale}/checkout/pay/return/${workspaceReservationId}`,
          origin
        );
        if (outcome) url.searchParams.set("outcome", outcome);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          code: "checkout_failed",
          message: "Payment checkout return URL could not be created.",
          cause,
        }),
    });
  },
  (effect) =>
    effect.pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError))
);

const getNotificationUrl: Effect.Effect<string, CheckoutError> = Effect.gen(
  function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL("/api/webhooks/nexi", origin);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          code: "checkout_failed",
          message: "Payment checkout notification URL could not be created.",
          cause,
        }),
    });
  }
).pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError));

const toNexiAmount = Schema.encodeEffect(NexiAmountFromWorkspaceMoney);

/** A Pay state that doesn't open for the submitting page's locale. */
const toInvalidPayStateError = (cause: PayStateTokenError) =>
  new CheckoutError({
    code: "checkout_failed",
    message: "Pay state is invalid or expired. Please review checkout again.",
    cause,
  });

const reissuePriceReviewPayState: (
  state: PayStateWithHoldExpiry,
  outcome: PayStateReissue
) => Effect.Effect<FreshPayState, CheckoutError, SealedStateKeys> = Effect.fn(
  "reissuePriceReviewPayState"
)((state, outcome) =>
  PayState.reissue(state, outcome).pipe(
    Effect.map(toFreshPayState),
    Effect.mapError(
      (cause) =>
        new CheckoutError({
          code: "checkout_failed",
          message: "A refreshed Pay state could not be created.",
          cause,
        })
    )
  )
);

const mapCheckoutFailure = <E>(cause: E | CheckoutError): CheckoutError =>
  cause instanceof CheckoutError
    ? cause
    : new CheckoutError({
        code: "checkout_failed",
        message:
          "Payment checkout could not be started. Please review your details and try again.",
        cause,
      });

const getCheckoutRedirectResult = (input: {
  readonly orderId: WorkspaceReservationId;
  readonly redirectUrl: string;
  readonly statusUrl?: string;
  readonly paid?: true;
}): CheckoutRedirectResult => ({ status: "redirect", ...input });

const getHostedPaymentCheckoutResult = (input: {
  readonly locale: Locale;
  readonly providerRedirectUrl: string;
  readonly workspaceReservationId: WorkspaceReservationId;
}): CheckoutRedirectResult =>
  getCheckoutRedirectResult({
    orderId: input.workspaceReservationId,
    redirectUrl: input.providerRedirectUrl,
    statusUrl: getReservationStatusPath({
      locale: input.locale,
      orderId: input.workspaceReservationId,
      setBypassCookie: true,
    }),
  });

const isDefinitiveHostedPaymentPageFailure = (
  cause: NexiExternalAPIError | NexiNetworkError
) =>
  cause._tag === "ExternalAPIError" &&
  cause.statusCode !== undefined &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  ![408, 409, 425, 429].includes(cause.statusCode);

function makeCheckoutServiceLayer(service: typeof CheckoutService) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const nexi = yield* NexiService;
      const reservations = yield* WorkspaceReservationRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const legalEvidenceEvents = yield* LegalEvidenceEventRepository;
      const paidFulfillment = yield* ReservationFulfillment;
      const checkoutAnalytics = yield* CheckoutAnalytics;
      const pricing = yield* CheckoutPricingService;
      const payableCheckout = yield* PayableCheckout;
      const accountSections = yield* CustomerAccountSections;
      const provideSealedStateKeys = Effect.provideService(
        SealedStateKeys,
        yield* SealedStateKeys
      );

      const handleHostedPaymentPageCreationFailure = Effect.fn(
        "checkout.handleHostedPaymentPageCreationFailure"
      )(
        (input: {
          readonly cause: NexiExternalAPIError | NexiNetworkError;
          readonly attempt: PaymentAttempt;
          readonly workspaceReservationId: WorkspaceReservationId;
        }) =>
          Match.value(input.cause).pipe(
            Match.when(
              isDefinitiveHostedPaymentPageFailure,
              Effect.fn(function* () {
                const transition = yield* paymentLifecycle.markTerminal({
                  id: input.attempt.id,
                  workspaceReservationId: input.workspaceReservationId,
                  state: "failed",
                  failureCode: "nexi_hpp_create_failed",
                  providerStatus: "hpp_create_failed",
                });

                if (transition.changed) {
                  yield* checkoutAnalytics.paymentFailed({
                    attempt: transition.attempt,
                    failureReason: "nexi_hpp_create_failed",
                    timestamp: transition.timestamp,
                  });
                }
              })
            ),
            Match.orElse(() =>
              Effect.logError(
                "Ambiguous hosted payment page creation failure retained the active attempt",
                {
                  orderId: input.workspaceReservationId,
                  paymentAttemptId: input.attempt.id,
                  errorTag: input.cause._tag,
                }
              )
            )
          )
      );

      /** Payment starts only on an order still payable right before it. */
      const reconfirmPayableCheckout = Effect.fn(
        "checkout.reconfirmPayableCheckout"
      )(function* (checkout: OpenCheckout) {
        yield* payableCheckout.reconfirm(checkout.state);
        yield* Effect.logDebug("Checkout payable reservation revalidated");
      });

      const startProviderSession = Effect.fn("checkout.startProviderSession")(
        function* (input: {
          readonly workspaceReservationId: WorkspaceReservationId;
          readonly correlationId: NexiCorrelationId;
          readonly locale: Locale;
          readonly total: Money;
          readonly commitment: DiscountCommitment;
          readonly customer: HostedPaymentCustomer;
          readonly accountingSnapshot: AccountingDocumentSnapshot;
          readonly reservation: SignedPayState["reservation"];
          readonly returnTarget: PaymentReturnTarget | undefined;
          readonly checkout: OpenCheckout;
        }) {
          yield* Effect.annotateLogsScoped({
            reservationId: input.workspaceReservationId,
            correlationId: input.correlationId,
            checkoutSessionId: input.checkout.state.checkoutSessionId,
            locale: input.locale,
            totalValue: input.total.value,
            totalCurrency: input.total.currency,
            hasCustomer: true,
          });
          yield* Effect.logInfo("Checkout provider session start requested");

          yield* reconfirmPayableCheckout(input.checkout);

          const providerOrderId = generateNexiOrderId();
          const nexiCurrency = getNexiCurrencyOverride();
          const nexiAmount = yield* toNexiAmount(
            nexiCurrency
              ? { ...input.total, currency: nexiCurrency }
              : input.total
          ).pipe(
            Effect.mapError(
              (cause) =>
                new CheckoutError({
                  code: "checkout_failed",
                  message: "Unsupported payment amount.",
                  cause,
                })
            )
          );
          const notificationUrl = yield* getNotificationUrl;
          const resultUrl = yield* getCheckoutPayReturnUrl(
            input.locale,
            input.workspaceReservationId
          );
          const cancelUrl = yield* getCheckoutPayReturnUrl(
            input.locale,
            input.workspaceReservationId,
            "cancelled"
          );
          yield* Effect.annotateLogsScoped({
            nexiAmount: nexiAmount.amount,
            nexiCurrency: nexiAmount.currency,
          });
          yield* Effect.logDebug("Checkout provider session inputs prepared");

          yield* ensureReservationHasNotEnded(input.reservation);

          yield* reservations.recordPaymentReturnTarget({
            id: input.workspaceReservationId,
            paymentReturnTarget: input.returnTarget,
          });

          // Once the attempt exists, finish creating and attaching its hosted
          // page even when the action deadline passes. Nexi has no idempotency
          // key, so cutting the request off would leave an ambiguous `created`
          // attempt; the Nexi request timeout still bounds this section.
          const { attachedAttempt, hostedPaymentPage } =
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const attempt =
                  yield* paymentLifecycle.createPendingNexiAttempt({
                    workspaceReservationId: input.workspaceReservationId,
                    providerOrderId,
                    amount: input.total,
                    commitment: input.commitment,
                    locale: input.locale,
                    accountingSnapshot: input.accountingSnapshot,
                  });
                if (!isNexiPaymentAttempt(attempt)) {
                  return yield* new CheckoutError({
                    code: "checkout_failed",
                    message: "Nexi payment attempt configuration is invalid.",
                  });
                }
                yield* Effect.annotateLogsScoped(
                  paymentAttemptLogFields(attempt)
                );
                yield* Effect.logInfo("Checkout payment attempt created");

                yield* Effect.logInfo(
                  "Nexi hosted payment page creation started"
                );
                const hostedPaymentPage = yield* nexi
                  .createHostedPaymentPage({
                    orderId: attempt.providerOrderId,
                    correlationId: input.correlationId,
                    amount: nexiAmount.amount,
                    currency: nexiAmount.currency,
                    locale: input.locale,
                    notificationUrl,
                    resultUrl,
                    cancelUrl,
                    customer: input.customer,
                  })
                  .pipe(
                    Effect.tapError((cause) =>
                      handleHostedPaymentPageCreationFailure({
                        cause,
                        attempt,
                        workspaceReservationId: input.workspaceReservationId,
                      })
                    )
                  );
                // Not the page itself: its URL and security token are secrets.
                yield* Effect.annotateLogsScoped({
                  providerOrderId: hostedPaymentPage.orderId,
                });
                yield* Effect.logInfo(
                  "Nexi hosted payment page creation completed"
                );

                yield* Effect.logInfo(
                  "Checkout hosted payment page attach started"
                );
                const attachedAttempt = yield* paymentLifecycle
                  .attachProviderSession({
                    id: attempt.id,
                    securityToken: hostedPaymentPage.securityToken,
                    providerRedirectUrl: hostedPaymentPage.hostedPage,
                  })
                  .pipe(
                    Effect.tapError((cause) =>
                      Effect.logError(
                        "Checkout hosted payment page attach failed",
                        {
                          attempt,
                          hostedPaymentPage,
                          cause,
                        }
                      )
                    )
                  );
                return { attachedAttempt, hostedPaymentPage };
              })
            );
          yield* checkoutAnalytics.paymentStarted({
            attempt: attachedAttempt,
            timestamp: attachedAttempt.updatedAt,
          });
          yield* Effect.logDebug(
            "Checkout hosted payment page attach completed"
          );
          yield* Effect.logInfo("Checkout provider session started");

          return getHostedPaymentCheckoutResult({
            locale: input.locale,
            providerRedirectUrl: hostedPaymentPage.hostedPage,
            workspaceReservationId: input.workspaceReservationId,
          });
        }
      );

      const completeInternalPayment = Effect.fn(
        "checkout.completeInternalPayment"
      )(function* (input: {
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly locale: Locale;
        readonly total: Money;
        readonly commitment: DiscountCommitment;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
        readonly reservation: SignedPayState["reservation"];
        readonly checkout: OpenCheckout;
      }) {
        yield* reconfirmPayableCheckout(input.checkout);

        yield* ensureReservationHasNotEnded(input.reservation);

        const transition = yield* paymentLifecycle.completeInternalPayment({
          workspaceReservationId: input.workspaceReservationId,
          amount: input.total,
          commitment: input.commitment,
          locale: input.locale,
          accountingSnapshot: input.accountingSnapshot,
        });

        if (transition.changed) {
          yield* checkoutAnalytics.paymentCompleted({
            attempt: transition.attempt,
            timestamp: transition.timestamp,
          });
        }

        yield* paidFulfillment.run(input.workspaceReservationId).pipe(
          Effect.catch((cause) =>
            Effect.logError(
              "Internal payment completed but paid fulfillment failed",
              {
                orderId: input.workspaceReservationId,
                paymentAttemptId: transition.attempt.id,
                cause,
              }
            )
          )
        );

        return getCheckoutRedirectResult({
          orderId: input.workspaceReservationId,
          redirectUrl: getReservationStatusPath({
            locale: input.locale,
            orderId: input.workspaceReservationId,
            outcome: "success",
            setBypassCookie: true,
          }),
          paid: true,
        });
      });

      const getCompletedCheckoutResult = Effect.fn(
        "checkout.getCompletedCheckoutResult"
      )(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly locale: Locale;
      }) {
        yield* paidFulfillment.run(input.orderId).pipe(
          Effect.catch((cause) =>
            Effect.logError("Paid checkout fulfillment retry failed", {
              orderId: input.orderId,
              cause,
            })
          )
        );

        return getCheckoutRedirectResult({
          orderId: input.orderId,
          redirectUrl: getReservationStatusPath({
            locale: input.locale,
            orderId: input.orderId,
            outcome: "success",
            setBypassCookie: true,
          }),
          paid: true,
        });
      });

      /**
       * An order that can't be paid again is either already paid, which the
       * resubmitted Pay state recovers, or still moving.
       */
      const recoverUnpayableOrder = Effect.fnUntraced(function* (input: {
        readonly unavailable: CheckoutUnavailableError;
        readonly locale: Locale;
      }) {
        const { unavailable } = input;
        yield* Effect.logInfo(
          "Hosted payment checkout reservation is unavailable",
          { orderId: unavailable.orderId, reason: unavailable.reason }
        );
        if (unavailable.paidOrderId !== undefined) {
          yield* Effect.logInfo(
            "Hosted payment checkout recovered completed reservation"
          );
          return yield* getCompletedCheckoutResult({
            orderId: unavailable.paidOrderId,
            locale: input.locale,
          });
        }

        yield* Effect.logWarning(
          "Hosted payment checkout returned in_progress: reservation unavailable"
        );

        return { status: "in_progress" as const };
      });

      type ReservationProgressInput = {
        /**
         * The order as opened, or as read again under the account lock; the
         * progress checks read only its payment state and active attempt.
         */
        readonly reservation: WorkspaceReservation;
        readonly state: SignedPayState;
        readonly locale: Locale;
        readonly returnTarget: PaymentReturnTarget | undefined;
      };

      /**
       * The result a paid order or an existing provider session already
       * decides; `undefined` when a new payment may start.
       */
      const findReservationProgressResult = Effect.fnUntraced(function* (
        input: ReservationProgressInput
      ) {
        const paidResult = yield* findPaidOrderResult(input);
        if (paidResult) return paidResult;
        return yield* findActiveAttemptResult(input);
      });

      const findPaidOrderResult = Effect.fnUntraced(function* ({
        reservation,
        locale,
      }: ReservationProgressInput) {
        if (reservation.paymentState === "paid") {
          yield* Effect.logInfo(
            "Hosted payment checkout reused completed reservation"
          );

          return yield* getCompletedCheckoutResult({
            orderId: reservation.id,
            locale,
          });
        }

        yield* Effect.annotateLogsScoped({
          correlationId: reservation.correlationId,
        });
        return undefined;
      });

      // An existing provider session can settle independently. Returning its
      // matching URL is idempotent recovery, not new payment initiation.
      const findActiveAttemptResult = Effect.fnUntraced(function* ({
        reservation,
        state,
        locale,
        returnTarget,
      }: ReservationProgressInput) {
        if (!reservation.activePaymentAttemptId) return undefined;

        yield* Effect.logDebug(
          "Hosted payment checkout active payment attempt lookup started"
        );
        const attempt = yield* paymentAttempts.findById(
          reservation.activePaymentAttemptId
        );
        yield* Effect.annotateLogsScoped(paymentAttemptLogFields(attempt));
        yield* Effect.logDebug(
          "Hosted payment checkout active payment attempt lookup completed"
        );
        if (!attempt || !isReusableAttemptState(attempt.state)) {
          return undefined;
        }

        const providerRedirectUrl = getReusableProviderRedirectUrl(attempt);
        if (
          providerRedirectUrl &&
          moneyEquals(attempt.amount, state.acceptedTotal)
        ) {
          yield* Effect.logInfo(
            "Hosted payment checkout reused active provider session"
          );
          // The reused page returns where this submission's answer points.
          yield* reservations.recordPaymentReturnTarget({
            id: reservation.id,
            paymentReturnTarget: returnTarget,
          });
          return getHostedPaymentCheckoutResult({
            locale,
            providerRedirectUrl,
            workspaceReservationId: reservation.id,
          });
        }

        yield* Effect.logInfo(
          "Hosted payment checkout returned in_progress: active attempt is not reusable for signed summary"
        );

        return { status: "in_progress" as const };
      });

      /** A signed state still awaiting the customer's review of a price change. */
      const getPendingPricingReviewResult = Effect.fnUntraced(
        function* (input: {
          readonly checkout: OpenCheckout;
          readonly changedKeys: CheckoutSummaryChangedKeys;
        }) {
          const { state } = input.checkout;
          yield* Effect.logInfo(
            "Hosted payment checkout returned existing pricing_changed review"
          );

          const priceReviewPayState = yield* reissuePriceReviewPayState(state, {
            kind: "review_pending",
          }).pipe(provideSealedStateKeys);
          return {
            status: "pricing_changed" as const,
            changedKeys: input.changedKeys,
            freshSummary: PayState.summary(state),
            ...priceReviewPayState,
          };
        }
      );

      /** Re-prices the signed order for the reservation's stored customer. */
      const affirmSignedPricing = Effect.fnUntraced(function* (input: {
        readonly checkout: OpenCheckout;
        readonly locale: Locale;
      }) {
        const { locale } = input;
        const { state } = input.checkout;
        const { dotyposCustomerId } = input.checkout.reservation;
        const verdict = yield* pricing.affirmForPayment({
          ...state,
          bookedAt: PayState.bookedAt(state),
          dotyposCustomerId,
          locale,
        });
        yield* Effect.annotateLogsScoped({
          quoteFingerprint: verdict.priced.quote.fingerprint,
        });
        yield* Effect.logDebug("Hosted payment checkout quote built");
        yield* Effect.logDebug(
          "Hosted payment checkout quote comparison started"
        );
        return { dotyposCustomerId, verdict };
      });

      /**
       * A fresh Pay state to review when the payment verdict says the signed
       * price changed; `undefined` when it still holds.
       */
      const findRepricedResult = Effect.fnUntraced(function* (input: {
        readonly checkout: OpenCheckout;
        readonly verdict: PriceVerdict<PaymentPriceAffirmation>;
      }) {
        const { verdict } = input;
        const { state } = input.checkout;
        if (verdict.status === "affirmed") return undefined;
        const { changedKeys } = verdict;
        const prepared = verdict.priced;
        const freshSummary = prepared.summary;
        yield* Effect.annotateLogsScoped({
          changedSectionKeys: changedKeys.sectionKeys.join(","),
          changedItemKeys: changedKeys.itemKeys.join(","),
          acceptedQuoteFingerprint: state.quote.fingerprint,
          acceptedTotalValue: state.acceptedTotal.value,
          freshQuoteFingerprint: prepared.quote.fingerprint,
          freshTotalValue: freshSummary.total.value,
        });
        yield* Effect.logInfo(
          "Hosted payment checkout returned pricing_changed"
        );

        const priceReviewPayState = yield* reissuePriceReviewPayState(state, {
          kind: "repriced",
          verdict,
        }).pipe(provideSealedStateKeys);
        return {
          status: "pricing_changed" as const,
          changedKeys,
          freshSummary,
          ...priceReviewPayState,
        };
      });

      return CheckoutService.of({
        createHostedPaymentCheckout: Effect.fn(
          "checkout.createHostedPaymentCheckout"
        )(
          function* (input, locale) {
            yield* Effect.annotateLogsScoped({
              locale,
              hasPayStateToken: input.payStateToken.length > 0,
              legalConsent: input.legalConsent === true,
              earlyPerformanceConsent: input.earlyPerformanceConsent === true,
              returnTarget: input.returnTarget,
            });
            yield* Effect.logInfo("Hosted payment checkout creation started");

            if (input.legalConsent !== true) {
              yield* Effect.logInfo(
                "Hosted payment checkout rejected: missing legal consent"
              );

              return yield* new CheckoutError({
                code: "legal_consent_required",
                message: "Legal consent is required before checkout.",
              });
            }

            const checkout = yield* payableCheckout
              .open({ payStateToken: input.payStateToken, page: { locale } })
              .pipe(
                Effect.catchTags({
                  PayStateTokenError: (cause) =>
                    Effect.fail(toInvalidPayStateError(cause)),
                  CheckoutUnavailableError: (unavailable) =>
                    Effect.succeed(unavailable),
                })
              );
            if (checkout instanceof CheckoutUnavailableError) {
              return yield* recoverUnpayableOrder({
                unavailable: checkout,
                locale,
              });
            }
            const { state, reservation } = checkout;
            yield* Effect.annotateLogsScoped({
              orderId: state.orderId,
              checkoutSessionId: state.checkoutSessionId,
              reservationKind: state.reservation.kind,
              ...reservationLogFields(reservation),
            });
            yield* Effect.logInfo("Hosted payment checkout pay state opened");

            const data = state.reservation;

            const progressResult = yield* findReservationProgressResult({
              reservation,
              state,
              locale,
              returnTarget: input.returnTarget,
            });
            if (progressResult) return progressResult;

            yield* ensureReservationHasNotEnded(state.reservation);

            if (state.changedKeys) {
              return yield* getPendingPricingReviewResult({
                checkout,
                changedKeys: state.changedKeys,
              });
            }

            const { dotyposCustomerId, verdict } = yield* affirmSignedPricing({
              checkout,
              locale,
            });

            const repricedResult = yield* findRepricedResult({
              checkout,
              verdict,
            });
            if (repricedResult) return repricedResult;
            const prepared = verdict.priced;
            yield* Effect.logDebug(
              "Hosted payment checkout quote comparison passed"
            );

            const contractAt = Temporal.Now.instant();
            const earlyPerformanceRequired = isEarlyPerformanceRequestRequired({
              reservation: state.reservation,
              contractAt,
            });

            if (
              earlyPerformanceRequired &&
              input.earlyPerformanceConsent !== true
            ) {
              yield* Effect.logInfo(
                "Hosted payment checkout rejected: missing early performance consent"
              );

              return yield* new CheckoutError({
                code: "early_performance_consent_required",
                message:
                  "Early performance consent is required before checkout.",
              });
            }

            // The full state-creating section runs inside the account
            // advisory lock: authority is re-checked under the lock and the
            // same lock is held until the section completes, so deletion
            // cannot interleave with the reservation update, legal evidence,
            // or payment start, and the account's submissions of one order
            // record its evidence and start its payment once. Attempt
            // admission locks the order's row, so no submission starts a
            // second attempt. Idempotent recovery paths above stay reachable
            // without the lock.
            return yield* accountSections
              .withOptionalAccount(
                Effect.fn(function* () {
                  // Another submission of this order may have started its
                  // payment, or the hold may have changed, since the check
                  // above: decide again under the account lock, before any
                  // evidence or provider work.
                  const lockedReservation = yield* reservations.findById(
                    reservation.id
                  );
                  // An order gone meanwhile can't be paid; the status page
                  // tells the customer what happened to it.
                  if (!lockedReservation) {
                    return { status: "in_progress" as const };
                  }
                  const lockedProgressResult =
                    yield* findReservationProgressResult({
                      reservation: lockedReservation,
                      state,
                      locale,
                      returnTarget: input.returnTarget,
                    });
                  if (lockedProgressResult) return lockedProgressResult;

                  yield* reservations.updateReservationDetails({
                    id: reservation.id,
                    reservationDetails:
                      getStoredWorkspaceReservationDetails(data),
                    locale,
                  });

                  const legalEvidence = getPaymentSubmitLegalEvidence({
                    locale,
                    acceptedAt: contractAt.toString(),
                    earlyPerformanceConsent: earlyPerformanceRequired,
                  });
                  const checkoutDetails = getCheckoutDetails({
                    locale,
                    priced: prepared,
                    legalEvidence,
                  });
                  yield* Effect.annotateLogsScoped({
                    acceptedDocumentCount: Object.keys(legalEvidence).length,
                    earlyPerformanceRequested: earlyPerformanceRequired,
                  });
                  yield* Effect.logInfo(
                    "Hosted payment checkout legal evidence recording started"
                  );
                  yield* legalEvidenceEvents.recordMany(
                    Object.values(checkoutDetails.legal).map((evidence) => ({
                      workspaceReservationId: reservation.id,
                      evidence,
                    }))
                  );
                  yield* Effect.logInfo(
                    "Hosted payment checkout legal evidence recorded"
                  );

                  const { dotyposReservationId } = reservation;

                  yield* dotypos.updateReservation({
                    reservationId: dotyposReservationId,
                    note: formatWorkspaceReservationNote({
                      paymentOrderId: reservation.id,
                      checkoutDetails,
                      reservation: checkoutDetails.reservation,
                    }),
                  });
                  yield* Effect.logInfo(
                    "Hosted payment checkout Dotypos reservation note updated"
                  );

                  yield* ensureReservationHasNotEnded(state.reservation);
                  const accountingSnapshot = makeAccountingDocumentSnapshot({
                    workspaceReservationId: reservation.id,
                    dotyposReservationId,
                    dotyposCustomerId,
                    locale,
                    prepared,
                  });
                  const expectedPrice = prepared.quote.payment.expectedPrice;
                  const startPayment =
                    expectedPrice.value === 0
                      ? completeInternalPayment({
                          workspaceReservationId: reservation.id,
                          locale,
                          total: expectedPrice,
                          commitment: prepared.commitment,
                          accountingSnapshot,
                          reservation: state.reservation,
                          checkout,
                        })
                      : startProviderSession({
                          workspaceReservationId: reservation.id,
                          correlationId: reservation.correlationId,
                          locale,
                          total: expectedPrice,
                          commitment: prepared.commitment,
                          customer: getNexiHostedPaymentCustomer({
                            id: dotyposCustomerId,
                            name: data.name,
                            email: data.email,
                            // Read in the region of the locale the Pay
                            // state was prepared, and its phone validated, in.
                            phone: parsePhoneNumber(
                              data.phone,
                              defaultPhoneRegion(state.locale)
                            ),
                          }),
                          accountingSnapshot,
                          reservation: state.reservation,
                          returnTarget: input.returnTarget,
                          checkout,
                        });

                  return yield* startPayment.pipe(
                    Effect.catchTag(
                      "DiscountClaimError",
                      Effect.fn(function* (cause) {
                        yield* Effect.logError(
                          "Accepted discount claim admission changed the payable price",
                          {
                            discountBoundary: "claim_admission",
                            discountOperation: cause.operation,
                            discountErrorReason: cause.reason,
                          }
                        );
                        // The claim moved the price after it was affirmed, so
                        // the customer reviews the re-priced order whatever
                        // it compares to: no verdict, only the changed keys.
                        const refreshed = yield* pricing.repriceForPayment({
                          ...state,
                          bookedAt: PayState.bookedAt(state),
                          dotyposCustomerId,
                          locale,
                        });
                        const refreshedSummary = refreshed.summary;
                        const changedKeys = getCheckoutSummaryChangedKeys(
                          PayState.summary(state),
                          refreshedSummary
                        );
                        const refreshedCheckoutDetails = getCheckoutDetails({
                          locale,
                          priced: refreshed,
                          legalEvidence,
                        });
                        yield* dotypos.updateReservation({
                          reservationId: dotyposReservationId,
                          note: formatWorkspaceReservationNote({
                            paymentOrderId: reservation.id,
                            checkoutDetails: refreshedCheckoutDetails,
                            reservation: refreshedCheckoutDetails.reservation,
                          }),
                        });
                        const priceReviewPayState =
                          yield* reissuePriceReviewPayState(checkout.state, {
                            kind: "repriced",
                            verdict: {
                              status: "pricing_changed",
                              priced: refreshed,
                              changedKeys,
                            },
                          }).pipe(provideSealedStateKeys);

                        return {
                          status: "pricing_changed" as const,
                          changedKeys,
                          freshSummary: refreshedSummary,
                          ...priceReviewPayState,
                        };
                      })
                    )
                  );
                })
              )
              .pipe(
                Effect.catchTag(
                  "CustomerAccountAccessError",
                  () =>
                    new CheckoutError({
                      code: "checkout_failed",
                      message:
                        "Reservation checkout is unavailable for this account.",
                    })
                )
              );
          },
          (effect, input, locale) =>
            effect.pipe(
              Effect.scoped,
              Effect.annotateLogs({
                locale,
                hasPayStateToken: input.payStateToken.length > 0,
              }),
              Effect.mapError(mapCheckoutFailure)
            )
        ),
      });
    })
  );
}
