import type { ComponentProps } from "react";
import { AdministrationCustomerDetail } from "@/features/administration/customer-detail";
import { renderCustomerDiscountSlots } from "./customer-admin-components";
import type { AdminCustomerProfile } from "./discount-administration.service";

/**
 * The customer detail as its page composes it: the administration's screen
 * with this profile's customer and discount slots.
 */
export function CustomerDetailWithDiscounts({
  locale,
  profile,
  ...props
}: Omit<
  ComponentProps<typeof AdministrationCustomerDetail>,
  "customerId" | "profile"
> & {
  readonly profile: AdminCustomerProfile;
}) {
  return (
    <AdministrationCustomerDetail
      {...props}
      customerId={profile.customer.id}
      locale={locale}
      profile={{
        customer: profile.customer,
        discounts: renderCustomerDiscountSlots({ locale, profile }),
      }}
    />
  );
}
