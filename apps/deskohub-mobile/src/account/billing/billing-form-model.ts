import type { CustomerProfile } from "@deskohub/workspace-customer-api";
import {
  type BillingChoice,
  billingFieldsOf,
  type ProfileDraft,
  type ProfileTextField,
} from "../profile/profile-draft";

/** The billing choices, in the order the screen offers them. */
export const billingChoiceOrder: ReadonlyArray<BillingChoice> = [
  "none",
  "personal",
  "business",
];

/** What the Billing details screen shows for the draft it edits. */
export interface BillingFormView {
  /** The company's name, IČO and VAT ID. */
  readonly company: boolean;
  /** The billing address. */
  readonly address: boolean;
  /**
   * Saving would remove the billing details the profile has saved: the
   * screen warns right under the choice that causes it.
   */
  readonly removesSavedBilling: boolean;
  /** The fields on screen, in order: the ones the footer counts and focuses. */
  readonly fields: ReadonlyArray<ProfileTextField>;
}

/**
 * The Billing details screen for the saved profile and the draft. The
 * draft keeps every billing field whichever choice shows, so company
 * details typed earlier come back when Business is chosen again; only the
 * chosen kind's fields are saved.
 */
export const billingFormView = (
  saved: CustomerProfile,
  draft: ProfileDraft
): BillingFormView => ({
  company: draft.billingKind === "business",
  address: draft.billingKind !== "none",
  removesSavedBilling:
    draft.billingKind === "none" && (saved.billing ?? null) !== null,
  fields: billingFieldsOf(draft.billingKind),
});
