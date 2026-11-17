import "server-only";

import { Layer } from "effect";
import { AccountAvatarReleaseGate } from "@/features/account/backend/account-release-gates";
import {
  type AccountStateCapabilities,
  type AccountStateLayers,
  accountStateCapabilities,
  liveAccountServiceLayers,
  unavailableUntilUsed,
} from "@/features/account/backend/account-state-capabilities";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import { PasskeyReleaseGateRequest } from "@/features/account/server/account-release-gates.server";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { ReservationOnSite } from "@/features/reservation/backend/reservation-on-site-details";
import { ReservationWithdrawalAvailability } from "@/features/reservation/backend/reservation-withdrawals";
import { WithdrawalReleaseGateRequest } from "@/features/withdrawal/backend/withdrawal-release-gate.server";

/** Everything the account page reads while it loads. */
export type AccountPageCapabilities =
  | AccountStateCapabilities
  | CustomerReservationHistoryService;

/** The layers the account page's capabilities come from. */
export type AccountPageLayers = AccountStateLayers & {
  readonly history: Layer.Layer<
    CustomerReservationHistoryService,
    Layer.Error<typeof CustomerReservationHistoryService.Live>
  >;
};

/**
 * The page's live layers: the request's memoized release decisions, shared
 * with its layouts and metadata, and the browser's referral cookie.
 */
export const liveAccountPageLayers: AccountPageLayers = {
  ...liveAccountServiceLayers,
  // The online withdrawal entry points show while their gate is open.
  // Confirmed bookings show the table and Wi-Fi their email sent, with the
  // tables read from the status page's shared snapshot.
  history: CustomerReservationHistoryService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReservationWithdrawalAvailability.ForProvidedGate.pipe(
          Layer.provide(WithdrawalReleaseGateRequest)
        ),
        ReservationOnSite.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              SharedAvailabilityInventoryLive,
              WorkspaceCheckoutNetworkDetailsService.Default
            )
          )
        )
      )
    )
  ),
  referralRelease: ReferralReleaseGateRequest,
  rememberedReferral: RememberedReferral.Cookies.pipe(
    Layer.provide(CurrentCustomerAccount.Live)
  ),
  passkeyRelease: PasskeyReleaseGateRequest,
  avatarRelease: AccountAvatarReleaseGate.Live,
};

/**
 * The account page's capabilities, built once at its edge: the account
 * state's (`accountStateCapabilities`) and its reservation history, each
 * degrading only the sections that use it when its layer can't be built.
 */
export const accountPageCapabilities = (
  layers: AccountPageLayers
): Layer.Layer<AccountPageCapabilities> =>
  Layer.merge(
    accountStateCapabilities(layers),
    layers.history.pipe(
      unavailableUntilUsed(CustomerReservationHistoryService, (failure) => ({
        load: () => failure,
      }))
    )
  );
