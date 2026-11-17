import { type Locale, m } from "@/features/i18n";
import { getOfficeReservationPath } from "@/features/reservation/routes";

export const siteHeaderSectionIds = {
  overview: "overview",
  ttrpg: "ttrpg",
  events: "events",
  locationMap: "location-map",
} as const;

type SiteHeaderMenuItemId =
  | "locationMap"
  | "coworking"
  | "meetingRoom"
  | "office"
  | "pricing"
  | "gallery"
  | "team"
  | "faq"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

export type DisabledSiteHeaderMenuItems = Partial<
  Record<SiteHeaderMenuItemId, boolean>
>;

/**
 * The full header's primary navigation. Kept free of server modules so the
 * header's browser tests measure the same menu production renders.
 */
export const createSiteHeaderLinks = (
  locale: Locale,
  disabledMenuItems: DisabledSiteHeaderMenuItems = {}
): SiteHeaderMenuItem[] => {
  const localePath = `/${locale}`;
  const links = [
    {
      id: "locationMap",
      label: m.landingNavWhereToFindUs({}, { locale }),
      href: `${localePath}#${siteHeaderSectionIds.locationMap}`,
    },
    {
      id: "coworking",
      label: m.landingNavCoworking({}, { locale }),
      href: `${localePath}/coworking`,
    },
    {
      id: "meetingRoom",
      label: m.landingNavMeetingRoom({}, { locale }),
      href: `${localePath}/meeting-room`,
    },
    {
      id: "office",
      label: m.landingNavPrivateOffice({}, { locale }),
      href: getOfficeReservationPath(locale),
    },
    {
      id: "pricing",
      label: m.landingNavPricing({}, { locale }),
      href: `${localePath}/pricing`,
    },
    {
      id: "gallery",
      label: m.landingNavGallery({}, { locale }),
      href: `${localePath}/gallery`,
    },
    {
      id: "team",
      label: m.landingNavOurTeam({}, { locale }),
      href: `${localePath}/team`,
    },
    {
      id: "faq",
      label: m.landingNavFaq({}, { locale }),
      href: `${localePath}/faq`,
    },
    {
      id: "contact",
      label: m.landingNavContactLabel({}, { locale }),
      href: `${localePath}/contact`,
    },
  ] satisfies SiteHeaderMenuItem[];

  return links.filter(({ id }) => disabledMenuItems[id] !== true);
};
