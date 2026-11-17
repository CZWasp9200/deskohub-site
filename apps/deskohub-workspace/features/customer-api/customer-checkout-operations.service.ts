import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  CustomerAccountContactService,
  CustomerAccountSections,
} from "@/features/account";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  acceptPayStatePriceChange,
  CheckoutReferralService,
  openPayStateWithHoldExpiry,
  PayableCheckout,
  requirePayStateAuthor,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  applyDiscountCodeToPayState,
  clearDiscountCodeFromPayState,
} from "@/features/checkout/backend/checkout/pay-state-discount-code";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { OvernightStayReleaseGate } from "@/features/reservation/backend/overnight-stay-release-gate";
import {
  prepareWorkspacePayState,
  ReservationBooking,
} from "@/features/reservation/backend/reservation-booking.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  failuresAsDefects,
  isRecoverableCause,
} from "@/shared/backend/workspace-effect";
import { CustomerReferralUpdates } from "./customer-referral-updates";

/** An operation's Effect without its requirements, which the service provides. */
type Provided<
  Operation extends (
    ...args: never[]
  ) => Effect.Effect<unknown, unknown, unknown>,
> = (
  ...args: Parameters<Operation>
) => Effect.Effect<
  Effect.Success<ReturnType<Operation>>,
  Effect.Error<ReturnType<Operation>> | CheckoutServicesUnavailable
>;

/**
 * The live services an operation needs couldn't be built, such as a missing
 * configuration. `cause` keeps the build failure.
 */
export class CheckoutServicesUnavailable extends Data.TaggedError(
  "CheckoutServicesUnavailable"
)<{ readonly cause: unknown }> {
  /** `layer`, failing to build as unavailable. */
  /**
   * `layer`, failing to build as unavailable, defects included; interruption
   * and Next.js control flow propagate.
   */
  static whenUnbuilt = <A, E, R>(
    layer: Layer.Layer<A, E, R>
  ): Layer.Layer<A, CheckoutServicesUnavailable, R> =>
    Layer.catchCause(layer, (cause) =>
      Layer.unwrap(
        isRecoverableCause(cause)
          ? Effect.fail(new CheckoutServicesUnavailable({ cause }))
          : Effect.failCause(failuresAsDefects(cause))
      )
    );
}

interface ICustomerCheckoutOperations {
  /** `prepareWorkspacePayState`, booked under the request's session. */
  readonly preparePayState: Provided<typeof prepareWorkspacePayState>;
  /** `applyDiscountCodeToPayState`, without bot protection. */
  readonly applyDiscountCode: Provided<typeof applyDiscountCodeToPayState>;
  /** `clearDiscountCodeFromPayState`, without bot protection. */
  readonly clearDiscountCode: Provided<typeof clearDiscountCodeFromPayState>;
  /**
   * `acceptPayStatePriceChange`: the sealing keys, and the reservation for a
   * state signed without its hold deadline.
   */
  readonly acceptPriceChange: Provided<typeof acceptPayStatePriceChange>;
  /** `requirePayStateAuthor`: the checkout's order was booked by the account. */
  readonly requireAuthor: Provided<typeof requirePayStateAuthor>;
  /** Opens a checkout state token the server issued, with its hold deadline. */
  readonly readPayState: Provided<typeof openPayStateWithHoldExpiry>;
  /**
   * `RememberedReferral.forgetIfSettled`: records that the client's code is
   * used once the booker's referral settles.
   */
  readonly forgetReferralIfSettled: Provided<
    RememberedReferral["Service"]["forgetIfSettled"]
  >;
}

/**
 * The shared checkout operations the customer HTTP API's booking checkout
 * calls, with the services the site's actions book through, except bot
 * protection: a native client can't run the browser challenge, and the
 * session, origin check and request budgets stand in for it. Each operation
 * builds its own services when it runs, so accepting a price builds only the
 * sealing keys and the reservation store, and a service that can't be built
 * fails only the operations that use it.
 */
export class CustomerCheckoutOperations extends Context.Service<
  CustomerCheckoutOperations,
  ICustomerCheckoutOperations
>()("@deskohub-workspace/customer-api/CustomerCheckoutOperations") {
  /**
   * Closes over the request's authentication, release gates and referral
   * updates, so the operations read the session the handler reads, and
   * share one decision per gate and one record of the client's referral
   * code with it.
   */
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      // The authentication the session middleware read the request through.
      const authentication = Layer.succeed(
        CustomerAuthentication,
        yield* CustomerAuthentication
      );
      const currentAccount =
        CurrentCustomerAccount.ForProvidedAuthentication.pipe(
          Layer.provide(authentication)
        );
      const releases = {
        referral: Layer.succeed(
          ReferralReleaseGate,
          yield* ReferralReleaseGate
        ),
        office: Layer.succeed(OfficeReleaseGate, yield* OfficeReleaseGate),
        overnightStay: Layer.succeed(
          OvernightStayReleaseGate,
          yield* OvernightStayReleaseGate
        ),
      };
      const { remembered } = yield* CustomerReferralUpdates;

      /** The site's preparation services, minus the browser's cookies. */
      const preparation = remembered.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            ReservationBooking.Live,
            ReferralService.Live,
            Layer.mergeAll(
              CustomerAccountSections.ForProvidedAuthentication,
              CurrentCustomerAccount.ForProvidedAuthentication,
              CustomerAccountContactService.ForProvidedAuthentication
            ).pipe(Layer.provide(authentication))
          )
        ),
        Layer.provideMerge(
          Layer.mergeAll(
            releases.referral,
            releases.office,
            releases.overnightStay
          )
        ),
        Layer.provide(WorkspaceDatabase.Default)
      );

      /** The site's discount code services, minus bot protection. */
      const discountCode = remembered.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            CheckoutPricingService.Live,
            PayableCheckout.Live,
            WorkspaceReservationRepository.Live,
            ReferralService.Live,
            CheckoutReferralService.Live,
            currentAccount,
            SealedStateKeys.Default
          )
        ),
        Layer.provideMerge(releases.referral)
      );

      /** What removing an entered code reprices and signs with. */
      const discountCodeRemoval = Layer.mergeAll(
        CheckoutPricingService.Live,
        PayableCheckout.Live,
        WorkspaceReservationRepository.Live,
        SealedStateKeys.Default
      ).pipe(Layer.provideMerge(releases.referral));

      /** What settling the client's referral code reads. */
      const referralSettlement = remembered.pipe(
        Layer.provide(
          Layer.mergeAll(ReferralService.Live, currentAccount).pipe(
            Layer.provideMerge(releases.referral)
          )
        )
      );

      /** Sealing keys and the reservations Pay states are signed for. */
      const payStates = Layer.mergeAll(
        SealedStateKeys.Default,
        WorkspaceReservationRepository.Live
      );

      return CustomerCheckoutOperations.of({
        preparePayState: (input) =>
          prepareWorkspacePayState(input).pipe(
            Effect.provide(CheckoutServicesUnavailable.whenUnbuilt(preparation))
          ),
        applyDiscountCode: (input) =>
          applyDiscountCodeToPayState(input).pipe(
            Effect.provide(
              CheckoutServicesUnavailable.whenUnbuilt(discountCode)
            )
          ),
        clearDiscountCode: (input) =>
          clearDiscountCodeFromPayState(input).pipe(
            Effect.provide(
              CheckoutServicesUnavailable.whenUnbuilt(discountCodeRemoval)
            )
          ),
        acceptPriceChange: (input) =>
          acceptPayStatePriceChange(input).pipe(
            Effect.provide(CheckoutServicesUnavailable.whenUnbuilt(payStates))
          ),
        requireAuthor: (input) =>
          requirePayStateAuthor(input).pipe(
            Effect.provide(CheckoutServicesUnavailable.whenUnbuilt(payStates))
          ),
        readPayState: (token) =>
          openPayStateWithHoldExpiry(token).pipe(
            Effect.provide(CheckoutServicesUnavailable.whenUnbuilt(payStates))
          ),
        forgetReferralIfSettled: (booker) =>
          RememberedReferral.pipe(
            Effect.flatMap((referral) => referral.forgetIfSettled(booker)),
            Effect.provide(
              CheckoutServicesUnavailable.whenUnbuilt(referralSettlement)
            )
          ),
      });
    })
  );
}
