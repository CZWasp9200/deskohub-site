import type { DotyposCustomerLifecycle } from "@deskohub/dotypos";

/**
 * The English display name of a Dotypos customer without a name. The
 * administration API and `dhw` return it as is; screens localize it.
 */
export const unnamedCustomerDisplayName = "Unnamed customer";

/**
 * The English display name that stands in for a deleted or expired Dotypos
 * customer's name. The administration API and `dhw` return it as is; screens
 * localize it from `lifecycle`.
 */
export const inactiveCustomerDisplayNames = {
  deleted: "Deleted customer",
  expired: "Expired customer",
} as const satisfies Record<
  Exclude<DotyposCustomerLifecycle, "active">,
  string
>;

/**
 * A customer's display name, and what it stands for, so the Admin UI can
 * name the customer in the operator's language.
 */
export type AdministrationCustomerName = {
  readonly displayName: string;
  /** False for an unnamed customer and for a deleted or expired one. */
  readonly hasName: boolean;
  /** The customer's Dotypos lifecycle when it was read. Never on the administration API contract. */
  readonly lifecycle: DotyposCustomerLifecycle;
};

/** Whether the customer is deleted or expired, so administration shows a placeholder and no contact details or detail page. */
export const isInactiveAdministrationCustomer = (customer: {
  readonly lifecycle: DotyposCustomerLifecycle | null;
}): customer is { readonly lifecycle: "deleted" | "expired" } =>
  customer.lifecycle === "deleted" || customer.lifecycle === "expired";
