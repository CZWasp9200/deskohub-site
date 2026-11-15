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
 * Which fields name a customer, in order. Each screen keeps its own until the
 * precedence is unified: then every entry points at one rule.
 */
export type CustomerNamePrecedence =
  /** Discounts, the customer detail and breadcrumb, and the API search and profile. */
  | "company-person-email-phone"
  /** The invoice customer picker. */
  | "company-person-email"
  /** Lists, reservations, bookings, the Overview, reservation authors, the CSV export and the API lists. */
  | "person-company";

// Each rule is the screen's own, kept as it was: rules that trim the joined
// person name keep inner whitespace as Dotypos holds it, while
// `getCustomerDisplayName` trims each part.
const customerNames = {
  "company-person-email-phone": (customer) => {
    const personName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return (
      customer.companyName?.trim() ||
      personName ||
      customer.email?.trim() ||
      customer.phone?.trim()
    );
  },
  "company-person-email": (customer) => {
    const personName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const email = customer.email?.trim() ?? "";
    return (customer.companyName?.trim() ?? "") || personName || email;
  },
  "person-company": getCustomerDisplayName,
} satisfies Record<
  CustomerNamePrecedence,
  (customer: DotyposCustomer) => string | undefined
>;

/** How an administrator sees a Dotypos customer's name under one screen's precedence. */
export const nameAdministrationCustomer = (
  customer: DotyposCustomer,
  precedence: CustomerNamePrecedence
): AdministrationCustomerName => {
  const name = customerNames[precedence](customer);
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
  /** Whether Dotypos holds a name under the screen's precedence, so the Admin UI can name an unnamed customer in the operator's language. */
  readonly hasName: boolean;
  readonly email: string | null;
  readonly phone: string | null;
};

/** A Dotypos customer's name and trimmed contact details; an empty detail is `null`. */
export const describeAdministrationCustomer = (
  customer: DotyposCustomer,
  precedence: CustomerNamePrecedence
): AdministrationCustomer => ({
  id: customer.id,
  ...nameAdministrationCustomer(customer, precedence),
  email: customer.email?.trim() || null,
  phone: customer.phone?.trim() || null,
});
