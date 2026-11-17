import {
  type DotyposCustomer,
  type DotyposCustomerId,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import {
  type AdministrationCustomerName,
  unnamedCustomerDisplayName,
} from "./customer-name";

/**
 * How an administrator sees a Dotypos customer's name: the person (first and
 * last name), else the company, else the email, else the phone, each part
 * trimmed. Unnamed when Dotypos holds none of them.
 */
export const nameAdministrationCustomer = (
  customer: DotyposCustomer
): AdministrationCustomerName => {
  const name =
    getCustomerDisplayName(customer) ||
    customer.email?.trim() ||
    customer.phone?.trim();
  return {
    displayName: name || unnamedCustomerDisplayName,
    hasName: Boolean(name),
  };
};

/** A Dotypos customer as administration lists and the administration API show it. */
export type AdministrationCustomer = {
  readonly id: DotyposCustomerId;
  /** Never empty: the API and `dhw` show "Unnamed customer" when `hasName` is false. */
  readonly displayName: string;
  /** Whether Dotypos holds a name, company, email or phone, so the Admin UI can name an unnamed customer in the operator's language. */
  readonly hasName: boolean;
  readonly email: string | null;
  readonly phone: string | null;
};

/** A Dotypos customer's name and trimmed contact details; an empty detail is `null`. */
export const describeAdministrationCustomer = (
  customer: DotyposCustomer
): AdministrationCustomer => ({
  id: customer.id,
  ...nameAdministrationCustomer(customer),
  email: customer.email?.trim() || null,
  phone: customer.phone?.trim() || null,
});
