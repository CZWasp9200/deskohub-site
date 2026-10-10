import {
  getAccountPath,
  getAccountSignInPath,
} from "@/features/account/routes";
import { areAccountsEnabled } from "@/features/account/server/account-feature-flag.server";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import { type Locale, m } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import {
  getCoworkReservationPath,
  getOfficeReservationPath,
} from "@/features/reservation/routes";

const siteHeaderSectionIds = {
  overview: "overview",
  ttrpg: "ttrpg",
  events: "events",
  locationMap: "location-map",
} as const;

export type SiteHeaderMenuItemId =
  | "locationMap"
  | "meetingRoom"
  | "office"
  | "gallery"
  | "team"
  | "faq"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

export type SiteHeaderAccountEntry = {
  readonly label: string;
  /** Account page for a signed-in customer, otherwise the sign-in page. */
  readonly href: Promise<string>;
  /** Shown while the session check is still pending. */
  readonly signInHref: string;
};

type DisabledSiteHeaderMenuItems = Partial<
  Record<SiteHeaderMenuItemId, boolean>
>;

export const getSiteHeaderLanguageLabels = (
  locale: Locale
): Record<Locale, string> => ({
  "cs-CZ": m.languageCzech({}, { locale }),
  "en-US": m.languageEnglish({}, { locale }),
});

export const getSiteHeaderAccessibilityLabels = (locale: Locale) => ({
  closeNavigationMenuLabel: m.closeNavigationMenuLabel({}, { locale }),
  languageSwitcherLabel: m.languageSwitcherLabel({}, { locale }),
  mobilePrimaryNavigationLabel: m.mobilePrimaryNavigationLabel({}, { locale }),
  openNavigationMenuLabel: m.openNavigationMenuLabel({}, { locale }),
  primaryNavigationLabel: m.primaryNavigationLabel({}, { locale }),
});

export async function getSiteHeaderConfig(locale: Locale) {
  const [accountsEnabled, meetingRoomPageEnabled, officePageEnabled] =
    await Promise.all([
      areAccountsEnabled(),
      isMeetingRoomPageEnabled(),
      isOfficePageEnabled(),
    ]);

  return createSiteHeaderConfig(locale, {
    accountsEnabled,
    disabledMenuItems: {
      meetingRoom: !meetingRoomPageEnabled,
      office: !officePageEnabled,
    },
  });
}

const createSiteHeaderConfig = (
  locale: Locale,
  {
    accountsEnabled,
    disabledMenuItems,
  }: {
    readonly accountsEnabled: boolean;
    readonly disabledMenuItems: DisabledSiteHeaderMenuItems;
  }
) => {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const links = [
    {
      id: "locationMap",
      label: m.landingNavWhereToFindUs({}, { locale }),
      href: localizedHash(`#${siteHeaderSectionIds.locationMap}`),
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

  return {
    ...getSiteHeaderAccessibilityLabels(locale),
    ...(accountsEnabled && { account: createSiteHeaderAccountEntry(locale) }),
    languageLabels: getSiteHeaderLanguageLabels(locale),
    links: links.filter(({ id }) => disabledMenuItems[id] !== true),
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: getCoworkReservationPath(locale),
  };
};

// Not awaited: the header streams the resolved link while the sign-in link
// stays in the static shell.
const createSiteHeaderAccountEntry = (
  locale: Locale
): SiteHeaderAccountEntry => ({
  label: m.accountNavLabel({}, { locale }),
  href: isCustomerSignedIn("site-header.account-link").then(
    (signedIn) =>
      signedIn ? getAccountPath(locale) : getAccountSignInPath(locale),
    () => getAccountSignInPath(locale)
  ),
  signInHref: getAccountSignInPath(locale),
});

export { siteHeaderSectionIds };
