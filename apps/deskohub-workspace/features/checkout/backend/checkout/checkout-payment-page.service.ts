import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentReturnTarget } from "@/features/checkout/payment-return-target";
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
import { PaymentPageProviderStatus } from "./payment-page-provider-status";
import {
  decidePaymentPageReopening,
  getPaymentPageToReopen,
} from "./reusable-payment-attempt";

/**
 * Why an order's payment page can't be opened again, each matching a status
 * the order already shows: it is paid, a late payment is being reconciled,
 * its hold was released, it has no payment page that is still open, or the
 * page no longer takes a payment (`window_elapsed`: the provider recorded
 * activity on its order, or, when it couldn't be asked, the provisional
 * reopening window ended).
 */
type PaymentPageClosedReason =
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
   * a visitor who closed it. It never starts a payment attempt; it reads the
   * provider's order once and records where the page's payment returns. The
   * page is offered while the reservation stays held for it, past the hold's
   * own expiry (the provider order keeps it held), and while the provider's
   * order shows no activity; when the provider can't be asked, only within
   * the provisional reopening window. The state can change after the answer,
   * as for any page already open: a payment that settles after its attempt
   * ended is reconciled by late-payment recovery.
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

const implementation = Effect.gen(function* () {
  const authorization = yield* ReservationAuthorizationService;
  const reservations = yield* WorkspaceReservationRepository;
  const paymentAttempts = yield* PaymentAttemptRepository;
  const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;
  const providerStatus = yield* PaymentPageProviderStatus;

  /**
   * Decides from the active attempt: an attempt that settled or ended, or
   * has no stored page, leaves nothing to open; its stored page is offered
   * while the provider's order shows no activity, as the status page's
   * action is.
   */
  const decideReopening = Effect.fnUntraced(function* (input: {
    readonly reservation: WorkspaceReservation;
    readonly attempt: PaymentAttempt | null;
  }) {
    const { reservation, attempt } = input;
    if (!attempt || attempt.workspaceReservationId !== reservation.id) {
      return closed("no_active_attempt");
    }
    const page = getPaymentPageToReopen(attempt, yield* currentInstant);
    if ("closed" in page) return closed(page.closed);
    const observation = yield* providerStatus.observe({ attempt, reservation });
    const decision = decidePaymentPageReopening(
      attempt,
      yield* currentInstant,
      observation
    );
    return decision === "open"
      ? ({
          state: "opened",
          providerRedirectUrl: page.providerRedirectUrl,
        } satisfies PaymentPageReopening)
      : closed(decision);
  });

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
      const result = yield* decideReopening({ reservation, attempt });
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
      Layer.provide(
        Layer.mergeAll(
          authorization,
          WorkspaceReservationRepository.Default,
          PaymentAttemptRepository.Default,
          LatePaymentRecoveryRepository.Default,
          PaymentPageProviderStatus.Live
        )
      ),
      Layer.provide(WorkspaceDatabase.Default)
    );

  static Live = this.withAuthorization(ReservationAuthorizationService.Live);
}
