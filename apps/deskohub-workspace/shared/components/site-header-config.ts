import {
  getAccountPath,
  getAccountSignInPath,
} from "@/features/account/routes";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import { createLocalePreferenceSaving } from "@/features/account/server/locale-preference-saving.server";
import { isCurrentAccountAdministrator } from "@/features/administrators/server/current-account-administrator.server";
import { type Locale, m } from "@/features/i18n";
import { languageNames } from "@/features/i18n/language-labels";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-release-gate.server";
import { isOfficePageEnabled } from "@/features/office/backend/office-release-gate.server";
import { getCoworkReservationPath } from "@/features/reservation/routes";
import {
  createSiteHeaderLinks,
  type DisabledSiteHeaderMenuItems,
} from "@/shared/components/site-header-links";

export type SiteHeaderAccountEntry = {
  readonly label: string;
  /** Account page for a signed-in customer, otherwise the sign-in page. */
  readonly href: Promise<string>;
  /** Shown while the session check is still pending. */
  readonly signInHref: string;
};

export type SiteHeaderAdministratorEntry = {
  /** True only for a signed-in administrator; customers never see the entry. */
  readonly visible: Promise<boolean>;
  readonly href: string;
  readonly label: string;
};

export const getSiteHeaderAccessibilityLabels = (locale: Locale) => ({
  closeNavigationMenuLabel: m.closeNavigationMenuLabel({}, { locale }),
  languageMenuTriggerLabel: m.languageMenuTriggerLabel(
    { language: languageNames[locale] },
    { locale }
  ),
  mobilePrimaryNavigationLabel: m.mobilePrimaryNavigationLabel({}, { locale }),
  openNavigationMenuLabel: m.openNavigationMenuLabel({}, { locale }),
  primaryNavigationLabel: m.primaryNavigationLabel({}, { locale }),
});

export async function getSiteHeaderConfig(locale: Locale) {
  const [meetingRoomPageEnabled, officePageEnabled] = await Promise.all([
    isMeetingRoomPageEnabled(),
    isOfficePageEnabled(),
  ]);

  return createSiteHeaderConfig(locale, {
    disabledMenuItems: {
      meetingRoom: !meetingRoomPageEnabled,
      office: !officePageEnabled,
    },
  });
}

const createSiteHeaderConfig = (
  locale: Locale,
  {
    disabledMenuItems,
  }: {
    readonly disabledMenuItems: DisabledSiteHeaderMenuItems;
  }
) => {
  return {
    ...getSiteHeaderAccessibilityLabels(locale),
    account: createSiteHeaderAccountEntry(locale),
    administrator: createSiteHeaderAdministratorEntry(locale),
    localePreference: createLocalePreferenceSaving(),
    links: createSiteHeaderLinks(locale, disabledMenuItems),
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
  href: isCustomerSignedIn().then(
    (signedIn) =>
      signedIn ? getAccountPath(locale) : getAccountSignInPath(locale),
    () => getAccountSignInPath(locale)
  ),
  signInHref: getAccountSignInPath(locale),
});

// Not awaited, like the account entry: the static shell renders without it and
// a failed check hides it.
const createSiteHeaderAdministratorEntry = (
  locale: Locale
): SiteHeaderAdministratorEntry => ({
  visible: isCurrentAccountAdministrator().catch(() => false),
  href: `/${locale}/admin`,
  label: m.siteHeaderAdminLabel({}, { locale }),
});
