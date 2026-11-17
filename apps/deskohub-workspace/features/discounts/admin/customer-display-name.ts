import {
  type AdministrationCustomerName,
  isInactiveAdministrationCustomer,
} from "@/features/administration/customer-name";
import { getAdministrationCustomerName } from "@/features/administration/customer-presentation";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** Names a customer in the operator's language: the deleted or expired placeholder, the name, or "Unnamed customer". */
export const formatDiscountAdminCustomerName = (
  customer: AdministrationCustomerName,
  locale: Locale
) => {
  if (isInactiveAdministrationCustomer(customer))
    return getAdministrationCustomerName(customer, locale);
  return customer.hasName
    ? customer.displayName
    : m.discountsUnnamedCustomer({}, { locale });
};
