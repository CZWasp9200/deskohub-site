import { Hourglass, UserRoundX } from "lucide-react";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { AdministrationLink as Link } from "./admin-link";
import { administrationHref } from "./administration-href";
import {
  type AdministrationCustomerName,
  isInactiveAdministrationCustomer,
} from "./customer-name";
import { getAdministrationCustomerName } from "./customer-presentation";

const inactiveCustomerIcons = {
  deleted: UserRoundX,
  expired: Hourglass,
} as const;

/**
 * A customer's name in the operator's language. A deleted or expired
 * customer's placeholder renders muted and italic with an icon, so it never
 * reads as a name or as "Unnamed customer".
 */
export function AdministrationCustomerNameLabel({
  customer,
  locale,
}: {
  readonly customer: AdministrationCustomerName;
  readonly locale: Locale;
}) {
  const name = getAdministrationCustomerName(customer, locale);
  if (!isInactiveAdministrationCustomer(customer)) return name;
  const Icon = inactiveCustomerIcons[customer.lifecycle];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-normal text-navy-blue/60 italic"
      data-customer-lifecycle={customer.lifecycle}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {name}
    </span>
  );
}

/**
 * The customer's name linking to their detail page. A deleted or expired
 * customer has no detail page, so its placeholder is not a link.
 */
export function AdministrationCustomerNameLink({
  className,
  customer,
  customerId,
  locale,
}: {
  readonly className?: string;
  readonly customer: AdministrationCustomerName;
  readonly customerId: DotyposCustomerId;
  readonly locale: Locale;
}) {
  if (isInactiveAdministrationCustomer(customer))
    return (
      <AdministrationCustomerNameLabel customer={customer} locale={locale} />
    );
  return (
    <Link
      className={className}
      href={administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId,
      })}
    >
      {getAdministrationCustomerName(customer, locale)}
    </Link>
  );
}
