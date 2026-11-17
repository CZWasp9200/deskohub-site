import type { Locale } from "@/features/i18n";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
import type { AdministrationCustomerName } from "./customer-name";
import { m } from "./i18n";

/**
 * A customer's name as the operator sees it: the placeholder for a deleted or
 * expired customer, else the name, else "Unnamed customer", in the operator's
 * language. Render it with `AdministrationCustomerNameLabel` so a placeholder
 * never looks like a name.
 */
export const getAdministrationCustomerName = (
  customer: AdministrationCustomerName,
  locale: Locale
) => {
  if (customer.lifecycle === "deleted")
    return m.administrationCustomerDeleted({}, { locale });
  if (customer.lifecycle === "expired")
    return m.administrationCustomerExpired({}, { locale });
  return customer.hasName
    ? customer.displayName
    : m.administrationCustomerUnnamed({}, { locale });
};

/** A customer's email and phone on one line, or a note that Dotypos holds neither. */
export const formatAdministrationCustomerContact = (
  customer: { readonly email: string | null; readonly phone: string | null },
  locale: Locale
) =>
  [customer.email, customer.phone].filter(Boolean).join(" · ") ||
  m.administrationCustomerNoContactDetails({}, { locale });

/** Names a customer's current marketing consent state in the operator's language. */
export const getAdministrationCustomerMarketingConsentLabel = (
  state: MarketingConsentStatus,
  locale: Locale
) =>
  ({
    active: m.administrationCustomerMarketingConsentGranted,
    absent: m.administrationCustomerMarketingConsentNever,
    withdrawn: m.administrationCustomerMarketingConsentWithdrawn,
  })[state]({}, { locale });
