import { createRoot } from "react-dom/client";
import { isLocale, m } from "@/features/i18n";
import { languageNames } from "@/features/i18n/language-labels";
import { MinimalSiteHeader } from "./minimal-site-header";
import { SiteHeader } from "./site-header";
import { createSiteHeaderLinks } from "./site-header-links";

const mountPoint = document.getElementById("site-header-test-root");

if (!mountPoint) {
  throw new Error("The SiteHeader browser harness root is missing.");
}

const locale = mountPoint.dataset.locale;

if (!(locale && isLocale(locale))) {
  throw new Error("The SiteHeader browser harness needs a supported locale.");
}

const languageMenuTriggerLabel = m.languageMenuTriggerLabel(
  { language: languageNames[locale] },
  { locale }
);
const administrator = mountPoint.dataset.administrator === "true";
const signedIn = mountPoint.dataset.session === "signed-in";
const signInHref = `/${locale}/auth/sign-in`;

// The full header renders the production menu with every item enabled, so it
// is measured at its widest.
createRoot(mountPoint).render(
  mountPoint.dataset.variant === "minimal" ? (
    <MinimalSiteHeader
      currentLocale={locale}
      languageMenuTriggerLabel={languageMenuTriggerLabel}
    />
  ) : (
    <SiteHeader
      account={{
        href: Promise.resolve(signedIn ? `/${locale}/account` : signInHref),
        label: m.accountNavLabel({}, { locale }),
        signInHref,
      }}
      administrator={{
        visible: Promise.resolve(administrator),
        href: `/${locale}/admin`,
        label: m.siteHeaderAdminLabel({}, { locale }),
      }}
      closeNavigationMenuLabel={m.closeNavigationMenuLabel({}, { locale })}
      contactHref={`/${locale}/reservation/cowork`}
      contactLabel={m.reservationNavCta({}, { locale })}
      currentLocale={locale}
      languageMenuTriggerLabel={languageMenuTriggerLabel}
      localePreference={{
        save: async () => undefined,
        signedIn: Promise.resolve(signedIn),
      }}
      links={createSiteHeaderLinks(locale)}
      mobilePrimaryNavigationLabel={m.mobilePrimaryNavigationLabel(
        {},
        { locale }
      )}
      openNavigationMenuLabel={m.openNavigationMenuLabel({}, { locale })}
      primaryNavigationLabel={m.primaryNavigationLabel({}, { locale })}
    />
  )
);
