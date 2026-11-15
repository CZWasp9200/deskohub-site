import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentReturnTarget } from "@/features/checkout/payment-return-target";
import { getPaymentAttemptAbandonmentCutoff } from "@/features/checkout/provider-order-abandonment";
import type { Locale } from "@/features/i18n";
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
import { currentInstant } from "@/shared/utils/temporal";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import { getLatePaymentStatusKind } from "./checkout-reservation-status-kind";
import { getReusableProviderRedirectUrl } from "./reusable-payment-attempt";

/**
 * Why an order's payment page can't be opened again, each matching a status
 * the order already shows: it is paid, a late payment is being reconciled,
 * its hold was released, it has no payment page that is still open, or the
 * local abandonment window of that page ended.
 */
export type PaymentPageClosedReason =
  | "paid"
  | "late_payment"
  | "released"
  | "no_active_attempt"
  | "window_elapsed";

export type PaymentPageReopening =
  | { readonly state: "opened"; readonly providerRedirectUrl: string }
  /** The order doesn't exist or the visitor may not see it. */
  | { readonly state: "not_found" }
  | { readonly state: "closed"; readonly reason: PaymentPageClosedReason };

export type PaymentPageReopeningInput = {
  readonly orderId: WorkspaceReservationId;
  /** The locale an emailed capability link was issued for. */
  readonly locale: Locale;
  readonly accessCookie?: string;
  /**
   * Where the page's payment returns the customer; absent for the site's
   * status page. Recorded when the page opens, as a checkout submission
   * records it: the last request that hands out the page decides.
   */
  readonly returnTarget?: PaymentReturnTarget;
};

type PaymentPageReopeningError =
  | EffectDrizzleQueryError
  | ReservationAuthorizationUnavailableError
  | WorkspaceReservationDetailsMalformedError;

export interface ICheckoutPaymentPageService {
  /**
   * The payment page the order's unpaid payment attempt already opened, for
   * a visitor who closed it. It never starts a payment attempt or contacts
   * the provider; it only records where the page's payment returns. The page
   * is offered while the reservation stays held for it, which the provider
   * order keeps up to its local abandonment window, past the hold's own
   * expiry. The state can change after the answer, as for any page already
   * open: a payment that settles after its attempt ended is reconciled by
   * late-payment recovery.
   */
  readonly reopen: (
    input: PaymentPageReopeningInput
  ) => Effect.Effect<PaymentPageReopening, PaymentPageReopeningError>;
}

const notFound: PaymentPageReopening = { state: "not_found" };
const closed = (reason: PaymentPageClosedReason): PaymentPageReopening => ({
  state: "closed",
  reason,
});

/**
 * Decides from what was read. An attempt that settled or ended, or that has
 * no stored page, leaves nothing to open; the stored page stays offered until
 * the window the status page also stops promising confirmation at.
 */
const decideReopening = (input: {
  readonly reservation: WorkspaceReservation;
  readonly attempt: PaymentAttempt | null;
  readonly now: Temporal.Instant;
}): PaymentPageReopening => {
  const { reservation, attempt, now } = input;
  if (!attempt || attempt.workspaceReservationId !== reservation.id) {
    return closed("no_active_attempt");
  }
  const providerRedirectUrl = getReusableProviderRedirectUrl(attempt);
  if (!providerRedirectUrl) return closed("no_active_attempt");
  if (
    Temporal.Instant.compare(
      now,
      getPaymentAttemptAbandonmentCutoff(attempt)
    ) >= 0
  ) {
    return closed("window_elapsed");
  }
  return { state: "opened", providerRedirectUrl };
};

const implementation = Effect.gen(function* () {
  const authorization = yield* ReservationAuthorizationService;
  const reservations = yield* WorkspaceReservationRepository;
  const paymentAttempts = yield* PaymentAttemptRepository;
  const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;

  const reopen = Effect.fn("CheckoutPaymentPageService.reopen")(
    function* (input: PaymentPageReopeningInput) {
      // A failed read fails rather than denies, so the visitor can retry.
      const authorized = yield* authorization.authorize({
        accessCookie: input.accessCookie,
        locale: input.locale,
        orderId: input.orderId,
        permission: "open-payment-page",
      });
      if (!authorized) return notFound;

      const reservation = yield* reservations.findById(input.orderId);
      if (!reservation) return notFound;
      if (reservation.paymentState === "paid") return closed("paid");

      const latePaymentRecovery =
        yield* latePaymentRecoveries.findLatestByWorkspaceReservationId(
          reservation.id
        );
      if (getLatePaymentStatusKind(reservation, latePaymentRecovery)) {
        return closed("late_payment");
      }
      if (reservation.reservationState !== "held") return closed("released");
      if (!reservation.activePaymentAttemptId) {
        return closed("no_active_attempt");
      }

      const attempt = yield* paymentAttempts.findById(
        reservation.activePaymentAttemptId
      );
      const result = decideReopening({
        reservation,
        attempt,
        now: yield* currentInstant,
      });
      if (result.state === "opened") {
        yield* reservations.recordPaymentReturnTarget({
          id: reservation.id,
          paymentReturnTarget: input.returnTarget,
        });
      }
      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.tap((result) =>
          Effect.logInfo("Payment page reopening decided", {
            state: result.state,
            ...(result.state === "closed" && { reason: result.reason }),
          })
        ),
        Effect.annotateLogs({ orderId: input.orderId })
      )
  );

  return { reopen };
});

export class CheckoutPaymentPageService extends Context.Service<
  CheckoutPaymentPageService,
  ICheckoutPaymentPageService
>()("@deskohub-workspace/checkout/CheckoutPaymentPageService") {
  static Default = Layer.effect(this, implementation);

  /**
   * The service deciding who may open a payment page through
   * `authorization`, such as one reading the customer API's session.
   */
  static withAuthorization = <E, R>(
    authorization: Layer.Layer<ReservationAuthorizationService, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(authorization),
      Layer.provide(WorkspaceReservationRepository.Default),
      Layer.provide(PaymentAttemptRepository.Default),
      Layer.provide(LatePaymentRecoveryRepository.Default),
      Layer.provide(WorkspaceDatabase.Default)
    );

  static Live = this.withAuthorization(ReservationAuthorizationService.Live);
}
