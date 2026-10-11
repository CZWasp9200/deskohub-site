import type {
  AdvertisedPriceRequest,
  CoworkAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  type WorkspaceCoworkCurrentTier,
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";

type CoworkAdvertisedPriceOfferSelection = {
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

const getCoworkTierAdvertisedPriceRequests = ({
  date,
  locale,
  offers,
  submittedCode,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly offers: ReadonlyArray<CoworkAdvertisedPriceOfferSelection>;
  readonly submittedCode?: CanonicalPromotionCode;
}): ReadonlyArray<CoworkAdvertisedPriceRequest> =>
  offers.map((offer) => ({
    locale,
    ...(submittedCode && { submittedCode }),
    reservation: getCoworkAdvertisedPriceReservation({
      entryTier: offer.entryTier,
      coffee: offer.coffee,
      ...(offer.monitorOption !== undefined && {
        monitorOption: offer.monitorOption,
      }),
      date,
    }),
  }));

// Both Reserved Desk variants are advertised so the paid workstation addon
// price is visible before the toggle is flipped. The canonical monitor option
// is display-only: workstation presence, not the chosen configuration,
// determines the amount, so the request never changes with the selection.
const reservedDeskAdvertisedOffers = [
  { entryTier: "reserved-desk", coffee: true },
  {
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: workspaceProductMonitorOptions[0],
  },
] as const satisfies ReadonlyArray<CoworkAdvertisedPriceOfferSelection>;

type CoworkDateAdvertisedPriceInput = {
  readonly date: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

/** The tier card prices the cowork form shows for its coffee choice. */
export const getCoworkFormAdvertisedPriceRequests = ({
  coffee,
  ...input
}: CoworkDateAdvertisedPriceInput & { readonly coffee: boolean }) =>
  getCoworkTierAdvertisedPriceRequests({
    ...input,
    offers: [
      { entryTier: "open-space", coffee },
      ...reservedDeskAdvertisedOffers,
    ],
  });

/**
 * Every cowork price the form can show on a date, whatever is selected, so a
 * page can render each tier card and addon price without a client fetch.
 */
export const getCoworkDateAdvertisedPriceRequests = (
  input: CoworkDateAdvertisedPriceInput
) =>
  getCoworkTierAdvertisedPriceRequests({
    ...input,
    offers: [
      { entryTier: "open-space", coffee: false },
      { entryTier: "open-space", coffee: true },
      ...reservedDeskAdvertisedOffers,
    ],
  });

export const getCoworkCoffeeAdvertisedPriceRequest = ({
  date,
  locale,
  submittedCode,
  tier,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly tier: WorkspaceCoworkCurrentTier;
}): AdvertisedPriceRequest => ({
  locale,
  ...(submittedCode && { submittedCode }),
  reservation: getCoworkAdvertisedPriceReservation({
    entryTier: tier,
    coffee: true,
    date,
  }),
});
