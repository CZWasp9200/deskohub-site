import { Context, Layer } from "effect";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import type { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerReservationHistoryWithAccessService } from "@/features/account/backend/customer-reservation-history-with-access.service";
import { ReservationInvoicePdfService } from "@/features/accounting/backend/reservation-invoice-pdf.service";
import { CheckoutPaymentPageService } from "@/features/checkout/backend/checkout/checkout-payment-page.service";
import { CheckoutPaymentRetryService } from "@/features/checkout/backend/checkout/checkout-payment-retry.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { ReferralReleaseGateForRun } from "@/features/referrals/referral-release-gate-run";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { ReservationWithdrawalAvailability } from "@/features/reservation/backend/reservation-withdrawals";
import { WithdrawalRepository } from "@/features/withdrawal/backend/withdrawal.repository";
import { WithdrawalService } from "@/features/withdrawal/backend/withdrawal.service";
import type { WithdrawalReleaseGate } from "@/features/withdrawal/backend/withdrawal-release-gate";
import { WithdrawalReleaseGateForRun } from "@/features/withdrawal/backend/withdrawal-release-gate-run";

type AuthorizationLayerError = Layer.Error<
  typeof ReservationAuthorizationService.ForProvidedAuthentication
>;

/**
 * The reservation services' Layers. Those that read the signed-in account
 * require the authentication the session middleware read the request
 * through, which the handlers provide.
 */
export type CustomerReservationServiceLayers = {
  /** The account's standing, whose stored link the history peeks. */
  readonly currentAccount: Layer.Layer<
    CurrentCustomerAccount,
    Layer.Error<typeof CurrentCustomerAccount.ForProvidedAuthentication>,
    CustomerAuthentication
  >;
  /**
   * The reservation history, read live as the account page reads it, with
   * today's door codes shown to whom `authorization` lets see them.
   */
  readonly history: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    CustomerReservationHistoryWithAccessService,
    Layer.Error<
      ReturnType<
        typeof CustomerReservationHistoryWithAccessService.withAuthorization<
          AuthorizationLayerError,
          never
        >
      >
    >
  >;
  /**
   * Who may see an order, decided for the account the request's
   * authentication reads, as `ReservationAuthorizationService.Live` decides
   * it for the browser session.
   */
  readonly authorization: Layer.Layer<
    ReservationAuthorizationService,
    AuthorizationLayerError,
    CustomerAuthentication
  >;
  /** Order statuses, refreshed as the status page refreshes them. */
  readonly checkoutStatus: Layer.Layer<
    CheckoutStatusService,
    Layer.Error<typeof CheckoutStatusService.Live>
  >;
  /** Unpaid payment pages, opened again for whom `authorization` lets. */
  readonly paymentPage: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    CheckoutPaymentPageService,
    Layer.Error<typeof CheckoutPaymentPageService.Live>
  >;
  /** Payment retries, for orders `authorization` lets a customer retry. */
  readonly paymentRetry: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    CheckoutPaymentRetryService,
    | Layer.Error<typeof CheckoutPaymentRetryService.Live>
    | Layer.Error<typeof ReferralReleaseGateForRun>,
    Layer.Services<typeof ReferralReleaseGateForRun>
  >;
  /** Door codes, shown to whom `authorization` lets see them. */
  readonly access: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    ReservationAccessService,
    Layer.Error<typeof ReservationAccessService.Live>
  >;
  /**
   * The online withdrawal service with its release gate, both decided for
   * the request, over the session's authentication.
   */
  readonly withdrawals: Layer.Layer<
    WithdrawalService | WithdrawalReleaseGate,
    Layer.Error<typeof WithdrawalService.ForProvidedAuthentication>,
    CustomerAuthentication
  >;
  /** Recorded withdrawals, which an order's status carries. */
  readonly withdrawalRecords: Layer.Layer<
    WithdrawalRepository,
    Layer.Error<typeof WithdrawalRepository.Live>
  >;
  /** Issued invoices, shown to whom `authorization` lets see them. */
  readonly invoice: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    ReservationInvoicePdfService,
    Layer.Error<typeof ReservationInvoicePdfService.Live>
  >;
};

/**
 * The reservation Layers each customer API request builds its operation
 * from, inside the request's Workspace request context, as
 * `CustomerAccountLayers` does for the account.
 */
export class CustomerReservationLayers extends Context.Service<
  CustomerReservationLayers,
  CustomerReservationServiceLayers
>()("@deskohub-workspace/customer-api/CustomerReservationLayers") {
  static Live = Layer.succeed(this, {
    currentAccount: CurrentCustomerAccount.ForProvidedAuthentication,
    // The online withdrawal entry points show while their gate is open.
    history: (authorization) =>
      CustomerReservationHistoryWithAccessService.withAuthorization(
        authorization
      ).pipe(
        Layer.provide(
          ReservationWithdrawalAvailability.ForProvidedGate.pipe(
            Layer.provide(WithdrawalReleaseGateForRun)
          )
        )
      ),
    authorization: ReservationAuthorizationService.ForProvidedAuthentication,
    checkoutStatus: CheckoutStatusService.Live,
    paymentPage: CheckoutPaymentPageService.withAuthorization,
    paymentRetry: (authorization) =>
      CheckoutPaymentRetryService.withAuthorization(authorization).pipe(
        Layer.provide(ReferralReleaseGateForRun)
      ),
    access: ReservationAccessService.withAuthorization,
    invoice: ReservationInvoicePdfService.withAuthorization,
    withdrawalRecords: WithdrawalRepository.Live,
    withdrawals: Layer.mergeAll(
      WithdrawalService.ForProvidedAuthentication,
      WithdrawalReleaseGateForRun
    ),
  });
}
