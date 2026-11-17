import {
  customerLifecycle,
  type DotyposCustomer,
  type DotyposCustomerId,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import {
  type AdministrationCustomerName,
  inactiveCustomerDisplayNames,
  unnamedCustomerDisplayName,
} from "./customer-name";

/**
 * How an administrator sees a Dotypos customer's name at `now`, the time the
 * record was read. A deleted or expired customer is never named: it gets its
 * placeholder. Otherwise the person (first and last name), else the company,
 * else the email, else the phone, each part trimmed; unnamed when Dotypos
 * holds none of them.
 */
export const nameAdministrationCustomer = (
  customer: DotyposCustomer,
  now: Date
): AdministrationCustomerName => {
  const lifecycle = customerLifecycle(customer, now);
  if (lifecycle !== "active")
    return {
      displayName: inactiveCustomerDisplayNames[lifecycle],
      hasName: false,
      lifecycle,
    };
  const name =
    getCustomerDisplayName(customer) ||
    customer.email?.trim() ||
    customer.phone?.trim();
  return {
    displayName: name || unnamedCustomerDisplayName,
    hasName: Boolean(name),
    lifecycle,
  };
};

/** A Dotypos customer as administration lists and the administration API show it. */
export type AdministrationCustomer = AdministrationCustomerName & {
  readonly id: DotyposCustomerId;
  /** Null when Dotypos holds none, and for a deleted or expired customer. */
  readonly email: string | null;
  /** Null when Dotypos holds none, and for a deleted or expired customer. */
  readonly phone: string | null;
};

/**
 * A Dotypos customer's name and trimmed contact details at `now`, the time
 * the record was read. A deleted or expired customer has no contact details.
 */
export const describeAdministrationCustomer = (
  customer: DotyposCustomer,
  now: Date
): AdministrationCustomer => {
  const name = nameAdministrationCustomer(customer, now);
  const active = name.lifecycle === "active";
  return {
    id: customer.id,
    ...name,
    email: (active && customer.email?.trim()) || null,
    phone: (active && customer.phone?.trim()) || null,
  };
};
