import { CompanyLookup } from "../../company-lookup/company-lookup";
import type { CompanyDetailsField } from "../../company-lookup/company-lookup-model";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import type { ProfileDraft } from "../profile/profile-draft";
import { profileFieldLabel } from "../profile/profile-fields";

// Every detail the registry returns is a profile billing field of the same name.
const billingDetails: ReadonlyArray<CompanyDetailsField> = [
  "companyName",
  "companyId",
  "vatId",
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
];

/**
 * The company lookup by IČO under the Company ID field (boards 07b and 13b),
 * on Billing details and onboarding's billing step alike. Apply changes the
 * draft through `onApply` like typing does; only a form with a Save button
 * (`remindsToSave`) says to press it afterwards.
 */
export function BillingCompanyLookup({
  draft,
  onApply,
  disabled,
  remindsToSave,
  locale,
}: {
  readonly draft: ProfileDraft;
  readonly onApply: (change: Partial<ProfileDraft>) => void;
  readonly disabled: boolean;
  readonly remindsToSave: boolean;
  readonly locale: AppLocale;
}) {
  return (
    <CompanyLookup
      companyId={draft.companyId}
      fields={billingDetails.map((field) => ({
        field,
        // The country is a picker labelled as in checkout (BillingAddressSection).
        label:
          field === "country"
            ? m.booking_details_country({}, { locale })
            : profileFieldLabel(field, locale),
      }))}
      onApply={onApply}
      disabled={disabled}
      remindsToSave={remindsToSave}
      locale={locale}
    />
  );
}
