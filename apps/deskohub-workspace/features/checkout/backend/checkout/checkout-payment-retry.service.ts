import "@/shared/polyfills/temporal";

import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { readStoredBookingContact } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingStorage } from "@/features/accounting/backend/accounting-storage";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { isEndedUnpaidPaymentState } from "@/features/order";
import {
  ReservationAuthorizationService,
  type ReservationAuthorizationUnavailableError,
} from "@/features/reservation/backend/reservation-authorization.service";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  currentInstant,
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { PaymentRetryHoldService } from "../holds/payment-retry-hold.service";
import { AttemptPromotionCodesRepository } from "../repositories/attempt-promotion-codes.repository";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import {
  findOrderCoworkStay,
  type RecreatedReservation,
  rebuildAcceptedReservation,
} from "../reservation/order-dotypos-reservation";
import { getWorkspaceReservationInterval } from "../reservation/workspace-table-assignment.service";
import { CheckoutPricingService } from "./checkout-pricing.service";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  type FreshPayState,
  PayState,
  type SignedPayStatePricing,
  toFreshPayState,
} from "./pay-state";
import {
  getPayStateCheckoutView,
  type PayStateCheckoutView,
} from "./pay-state-checkout-view";
import {
  toPayStateHoldExpiresAt,
  withPayStateHoldExpiry,
} from "./pay-state-hold";
import { PaymentRetryProviderCheck } from "./payment-retry-provider-check";
import { PaymentRetryUnavailableError } from "./payment-retry-unavailable";

export { PaymentRetryUnavailableError } from "./payment-retry-unavailable";

/**
 * Why an order's payment can't be tried again in place; booking the same
 * selection again is the way on. The order is `paid`; its payment is still
 * open or under way (`payment_in_progress`); a `late_payment` of it is being
 * checked; a newer booking in its checkout `superseded` it; its reservation
 * was cancelled for another reason than its unpaid hold
 * (`reservation_cancelled`) or has ended (`reservation_ended`); its details
 * can't be rebuilt from the records that own them (`details_unavailable`);
 * or its records disagree in a way a person must look at (`needs_review`).
 */
type PaymentRetryRefusalReason =
  | "paid"
  | "payment_in_progress"
  | "late_payment"
  | "superseded"
  | "reservation_cancelled"
  | "reservation_ended"
  | "details_unavailable"
  | "needs_review";

export type PaymentRetryPreparation =
  /**
   * A Pay state for the same order, bound to it rather than to a checkout
   * session, priced now, and the checkout built from exactly that state. A
   * view with `changedKeys` asks the customer to accept the changed price
   * first; otherwise the terms are confirmed again.
   */
  | {
      readonly state: "ready";
      readonly payState: FreshPayState;
      readonly checkout: PayStateCheckoutView;
    }
  /** The order doesn't exist or the visitor may not see it. */
  | { readonly state: "not_found" }
  | {
      readonly state: "not_retryable";
      readonly reason: PaymentRetryRefusalReason;
    }
  /** The reserved spot was taken after the order's hold was released. */
  | { readonly state: "spot_unavailable" }
  /** The provider shows the earlier payment may still settle. */
  | { readonly state: "payment_settling" };

type PaymentRetryInput = {
  readonly orderId: WorkspaceReservationId;
  /** The locale the retry's Pay page or app checkout continues in. */
  readonly locale: Locale;
  readonly accessCookie?: string;
};

type PaymentRetryError =
  | EffectDrizzleQueryError
  | WorkspaceReservationDetailsMalformedError
  | ReservationAuthorizationUnavailableError
  | PaymentRetryUnavailableError;

export interface ICheckoutPaymentRetryService {
  /**
   * Prepares paying the same order again after its payment failed, was
   * cancelled or expired. It asks the provider that the ended payment moved
   * no money, keeps the order's hold or books the same reservation again,
   * rebuilds the order from the records that own its facts, and issues an
   * order-bound Pay state priced now. It never starts a payment: submitting
   * the state does, through the ordinary checkout, after the terms are
   * confirmed again. Preparing again returns another state on the same hold.
   */
  readonly prepare: (
    input: PaymentRetryInput
  ) => Effect.Effect<PaymentRetryPreparation, PaymentRetryError>;
}

const notFound: PaymentRetryPreparation = { state: "not_found" };
const refused = (
  reason: PaymentRetryRefusalReason
): PaymentRetryPreparation => ({
  state: "not_retryable",
  reason,
});

const unavailable = (message: string) => (cause: unknown) =>
  new PaymentRetryUnavailableError({ message, cause });

const sameEmail = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

const implementation = Effect.gen(function* () {
  const authorization = yield* ReservationAuthorizationService;
  const reservations = yield* WorkspaceReservationRepository;
  const paymentAttempts = yield* PaymentAttemptRepository;
  const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;
  const snapshots = yield* AccountingDocumentSnapshots;
  const promotionCodes = yield* AttemptPromotionCodesRepository;
  const accountLinks = yield* CustomerAccountLinkRepository;
  const dotypos = yield* DotyposService;
  const providerCheck = yield* PaymentRetryProviderCheck;
  const holds = yield* PaymentRetryHoldService;
  const pricing = yield* CheckoutPricingService;
  const provideSealedStateKeys = Effect.provideService(
    SealedStateKeys,
    yield* SealedStateKeys
  );

  /**
   * The order's contact as the records that own it hold it now: for an order
   * booked as the author's own account, the account's login email with its
   * linked Dotypos profile; for anyone else, the order's Dotypos customer.
   * It must name the email the order's documents go to, or nothing is
   * rebuilt.
   */
  const rebuildContact = Effect.fnUntraced(function* (input: {
    readonly order: WorkspaceReservation;
    readonly snapshot: AccountingDocumentSnapshot;
  }) {
    const { order, snapshot } = input;
    const deliveryEmail = snapshot.delivery?.email;
    if (!deliveryEmail) return undefined;
    const customer = yield* dotypos
      .getCustomer(order.dotyposCustomerId)
      .pipe(Effect.mapError(unavailable("The customer could not be read.")));
    if (Option.isNone(customer)) return undefined;
    const stored = readStoredBookingContact(customer.value);
    if (!stored?.phone) return undefined;

    const linkedCustomer = yield* accountLinks
      .find(order.authorAccountId)
      .pipe(Effect.mapError(unavailable("The account could not be read.")));
    let email = customer.value.email ?? undefined;
    if (linkedCustomer === order.dotyposCustomerId) {
      const account = yield* accountLinks
        .findActivityState(order.authorAccountId)
        .pipe(Effect.mapError(unavailable("The account could not be read.")));
      if (account.kind !== "active" || account.deletionRequestedAt) {
        return undefined;
      }
      email = account.email;
    }
    if (!email || !sameEmail(email, deliveryEmail)) return undefined;
    return { name: stored.name, email: deliveryEmail, phone: stored.phone };
  });

  /**
   * Prices the rebuilt order now: an entered code the attempt was priced
   * with is applied again as if entered, and the rest is affirmed as payment
   * affirms a signed price. A code that no longer applies is left out, and
   * any change asks the customer to accept it.
   */
  const issuePayState = Effect.fnUntraced(function* (input: {
    readonly fresh: BuildSignedPayStateInput;
    readonly enteredCode: CanonicalPromotionCode | undefined;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) {
    const { fresh, enteredCode } = input;
    const candidate = yield* buildSignedPayState(fresh);
    const pricingInput = {
      ...candidate,
      bookedAt: yield* currentInstant,
      dotyposCustomerId: input.dotyposCustomerId,
      locale: fresh.locale,
    };
    if (enteredCode !== undefined) {
      const applied = yield* pricing
        .applyDiscountCode({ ...pricingInput, submittedCode: enteredCode })
        .pipe(
          Effect.map(Option.some),
          Effect.catchTag("PromotionCodeUnavailableError", () =>
            Effect.succeed(Option.none())
          )
        );
      if (Option.isSome(applied)) {
        return yield* PayState.reissue(candidate, {
          kind: "code_entered",
          code: enteredCode,
          verdict: applied.value,
        });
      }
    }
    const verdict = yield* pricing.affirmForPayment(pricingInput);
    return verdict.status === "affirmed"
      ? yield* PayState.issue(fresh)
      : yield* PayState.reissue(candidate, { kind: "repriced", verdict });
  });

  /**
   * Everything a retry reads before it touches the hold: the attempt it
   * retries, and the order rebuilt from the records that own its facts.
   */
  const findRetry = Effect.fnUntraced(function* (input: {
    readonly order: WorkspaceReservation;
    readonly attempt: PaymentAttempt;
  }): Effect.fn.Return<
    | PaymentRetryPreparation
    | {
        readonly recreated: RecreatedReservation;
        readonly snapshot: AccountingDocumentSnapshot;
      },
    PaymentRetryError
  > {
    const { order, attempt } = input;
    const current = yield* reservations.findCurrentByCheckoutSessionKey(
      order.checkoutSessionKey
    );
    if (current?.id !== order.id) return refused("superseded");

    const snapshot = yield* snapshots
      .find(attempt.id)
      .pipe(
        Effect.mapError(unavailable("The order's records could not be read."))
      );
    if (!snapshot) return refused("details_unavailable");
    // Workspace stores no stay: an overnight Reserved Desk is booked again
    // from the bounds of the order's Dotypos reservation.
    const coworkStay = order.dotyposReservationId
      ? yield* findOrderCoworkStay({
          order,
          dotyposReservationId: order.dotyposReservationId,
        }).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.mapError(
            unavailable("The order's Dotypos reservation could not be read.")
          )
        )
      : undefined;
    const recreated = rebuildAcceptedReservation(order, snapshot, coworkStay);
    if (!recreated) return refused("details_unavailable");
    const interval = yield* getWorkspaceReservationInterval(
      recreated.reservation
    ).pipe(Effect.option);
    if (Option.isNone(interval)) return refused("details_unavailable");
    if (hasReservationIntervalEnded(interval.value, yield* currentInstant)) {
      return refused("reservation_ended");
    }
    return { recreated, snapshot };
  });

  const prepare = Effect.fn("CheckoutPaymentRetryService.prepare")(
    function* (input: PaymentRetryInput) {
      // A failed read fails rather than denies, so the visitor can retry.
      const authorized = yield* authorization.authorize({
        accessCookie: input.accessCookie,
        locale: input.locale,
        orderId: input.orderId,
        permission: "retry-payment",
      });
      if (!authorized) return notFound;

      const order = yield* reservations.findById(input.orderId);
      if (!order) return notFound;
      if (order.paymentState === "paid") return refused("paid");
      const latePaymentRecovery =
        yield* latePaymentRecoveries.findLatestByWorkspaceReservationId(
          order.id
        );
      if (latePaymentRecovery) return refused("late_payment");

      // The retry pays the order again after its newest attempt, the active
      // one or, once a retry was prepared, the one that retry cleared.
      const attempt = yield* paymentAttempts.findNewestForReservation(order.id);
      if (!attempt || !isEndedUnpaidPaymentState(order.paymentState)) {
        return refused("payment_in_progress");
      }
      if (
        !isEndedUnpaidPaymentState(attempt.state) ||
        (order.activePaymentAttemptId !== null &&
          order.activePaymentAttemptId !== attempt.id)
      ) {
        return refused("needs_review");
      }

      const retry = yield* findRetry({ order, attempt });
      if ("state" in retry) return retry;

      const provider = yield* providerCheck.check({
        attempt,
        reservation: order,
      });
      if (provider === "may_settle") {
        return { state: "payment_settling" } as const;
      }
      if (provider === "no_provider_order") return refused("needs_review");

      const contact = yield* rebuildContact({
        order,
        snapshot: retry.snapshot,
      });
      const billing = retry.snapshot.billing;
      if (!contact || !billing) return refused("details_unavailable");
      const codes = yield* promotionCodes.find(attempt.id);

      const hold = yield* holds
        .secure({
          orderId: order.id,
          retriedAttemptId: attempt.id,
          recreated: retry.recreated,
        })
        .pipe(
          Effect.mapError(unavailable("The order's hold could not be secured."))
        );
      if (hold.kind === "spot_unavailable") {
        return { state: "spot_unavailable" } as const;
      }
      if (hold.kind === "refused") {
        switch (hold.reason) {
          case "not_retryable":
            return refused("reservation_cancelled");
          case "release_in_progress":
            return yield* new PaymentRetryUnavailableError({
              message: "The order's hold is being released right now.",
            });
          case "release_refused":
          case "changed":
            return refused("needs_review");
        }
      }
      const holdExpiresAt = hold.reservation.reservationHoldExpiresAt;
      if (!holdExpiresAt) return refused("needs_review");

      const now = yield* currentInstant;
      const fresh: BuildSignedPayStateInput = {
        locale: input.locale,
        orderId: order.id,
        bookedAt: instantStringSchema.make(temporalInstantToIsoString(now)),
        holdExpiresAt: toPayStateHoldExpiresAt(holdExpiresAt),
        binding: "order",
        retriedAttemptId: attempt.id,
        // Typed as the Pay state's order: building the state decodes it
        // strictly, and a field today's rules refuse fails as invalid.
        ...({
          reservation: {
            ...retry.recreated.reservation,
            ...contact,
            billing,
          },
          quote: retry.snapshot.quote,
        } as SignedPayStatePricing),
        ...(codes.referralCode !== undefined && {
          referralCode: codes.referralCode,
        }),
      };
      const issued = yield* issuePayState({
        fresh,
        enteredCode: codes.enteredCode,
        dotyposCustomerId: order.dotyposCustomerId,
      }).pipe(
        provideSealedStateKeys,
        Effect.catchTags({
          // The rebuilt order doesn't decode as a Pay state, such as a
          // stored phone today's rules refuse.
          PayStateTokenError: (cause) =>
            cause.code === "invalid-token"
              ? Effect.succeed(undefined)
              : Effect.fail(
                  unavailable("The Pay state could not be sealed.")(cause)
                ),
          PayStateIssueError: unavailable("The Pay state could not be sealed."),
        }),
        Effect.mapError((cause) =>
          cause instanceof PaymentRetryUnavailableError
            ? cause
            : unavailable("The order could not be priced.")(cause)
        )
      );
      if (!issued) return refused("details_unavailable");
      const signed = yield* PayState.open(issued.payStateToken).pipe(
        provideSealedStateKeys,
        Effect.mapError(unavailable("The Pay state could not be opened."))
      );
      return {
        state: "ready",
        payState: toFreshPayState(issued),
        checkout: getPayStateCheckoutView(
          withPayStateHoldExpiry(signed, {
            reservationHoldExpiresAt: holdExpiresAt,
          }),
          yield* currentInstant
        ),
      } satisfies PaymentRetryPreparation;
    },
    (effect, input) =>
      effect.pipe(
        Effect.tap((result) =>
          Effect.logInfo("Payment retry prepared", {
            state: result.state,
            ...(result.state === "not_retryable" && { reason: result.reason }),
          })
        ),
        Effect.annotateLogs({ orderId: input.orderId })
      )
  );

  return CheckoutPaymentRetryService.of({ prepare });
});

export class CheckoutPaymentRetryService extends Context.Service<
  CheckoutPaymentRetryService,
  ICheckoutPaymentRetryService
>()("@deskohub-workspace/checkout/CheckoutPaymentRetryService") {
  static Default = Layer.effect(this, implementation);

  /**
   * The service deciding who may retry a payment through `authorization`,
   * such as one reading the customer API's session.
   */
  static withAuthorization = <E, R>(
    authorization: Layer.Layer<ReservationAuthorizationService, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          authorization,
          PaymentRetryHoldService.Live,
          PaymentRetryProviderCheck.Live,
          CheckoutPricingService.Live,
          AccountingStorage.Live,
          WorkspaceDotyposLayer,
          SealedStateKeys.Default,
          Layer.mergeAll(
            WorkspaceReservationRepository.Default,
            PaymentAttemptRepository.Default,
            LatePaymentRecoveryRepository.Default,
            AttemptPromotionCodesRepository.Default,
            CustomerAccountLinkRepository.Default
          ).pipe(Layer.provide(WorkspaceDatabase.Default))
        )
      )
    );

  static Live = this.withAuthorization(ReservationAuthorizationService.Live);
}
