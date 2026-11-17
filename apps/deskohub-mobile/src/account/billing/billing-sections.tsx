import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ChoiceList } from "../../ui/choice-list";
import { CountryField } from "../../ui/country-field";
import { FieldPair } from "../../ui/field-pair";
import { SectionHeader } from "../../ui/list";
import { space } from "../../ui/tokens";
import type {
  BillingChoice,
  CompletionTextField,
  ProfileDraft,
  ProfileDraftInvalid,
  ProfileTextField,
} from "../profile/profile-draft";
import {
  type ProfileFieldRefs,
  ProfileTextFields,
  profileFieldProblemMessage,
} from "../profile/profile-fields";
import { BillingCompanyLookup } from "./billing-company-lookup";
import { billingChoiceOrder } from "./billing-form-model";

// The billing part of a profile draft, shared by Account › Billing details
// and onboarding's Billing details step: one set of fields, one IČO lookup.

/** The props every billing section of a profile draft form shares. */
export interface BillingFieldProps {
  readonly draft: ProfileDraft;
  readonly invalid: ProfileDraftInvalid<CompletionTextField> | undefined;
  readonly onChange: (field: ProfileTextField, value: string) => void;
  readonly inputs: ProfileFieldRefs;
  readonly editable: boolean;
  readonly locale: AppLocale;
}

const choiceLabel = (choice: BillingChoice, locale: AppLocale) =>
  ({
    none: m.profile_billing_none,
    personal: m.profile_billing_personal,
    business: m.profile_billing_business,
  })[choice]({}, { locale });

const choiceDescription = (choice: BillingChoice, locale: AppLocale) =>
  ({
    none: m.billing_none_description,
    personal: m.billing_personal_description,
    business: m.billing_business_description,
  })[choice]({}, { locale });

/** No billing details, Personal or Business, each saying what it gives. */
export function BillingChoices({
  selected,
  onSelect,
  disabled,
  locale,
}: {
  readonly selected: BillingChoice;
  readonly onSelect: (choice: BillingChoice) => void;
  readonly disabled: boolean;
  readonly locale: AppLocale;
}) {
  return (
    <ChoiceList
      label={m.billing_invoices_go_to({}, { locale })}
      choices={billingChoiceOrder.map((choice) => ({
        value: choice,
        label: choiceLabel(choice, locale),
        description: choiceDescription(choice, locale),
      }))}
      selected={selected}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}

/**
 * The company's name and IČO, the lookup by IČO under it (applied through
 * `onApply` like typing), then the VAT ID. `remindsToSave`: the form has a
 * Save button, which the applied lookup then mentions.
 */
export function BillingCompanySection({
  onApply,
  remindsToSave,
  ...fields
}: BillingFieldProps & {
  readonly onApply: (change: Partial<ProfileDraft>) => void;
  readonly remindsToSave: boolean;
}) {
  const { draft, editable, locale } = fields;
  return (
    <View style={styles.section}>
      <SectionHeader title={m.billing_company_section({}, { locale })} />
      <ProfileTextFields {...fields} fields={["companyName"]} />
      <View style={styles.companyIdLookup}>
        <ProfileTextFields {...fields} fields={["companyId"]} />
        <BillingCompanyLookup
          draft={draft}
          onApply={onApply}
          disabled={!editable}
          remindsToSave={remindsToSave}
          locale={locale}
        />
      </View>
      <ProfileTextFields {...fields} fields={["vatId"]} />
    </View>
  );
}

/** Street and apartment, then city and postal code side by side, then the country. */
export function BillingAddressSection(fields: BillingFieldProps) {
  const { draft, onChange, locale, invalid, editable, inputs } = fields;
  const problem = invalid?.fields.country;
  return (
    <View style={styles.section}>
      <SectionHeader title={m.billing_address_section({}, { locale })} />
      <ProfileTextFields
        {...fields}
        fields={["addressLine1", "addressLine2"]}
      />
      <FieldPair
        wide={<ProfileTextFields {...fields} fields={["city"]} />}
        narrow={<ProfileTextFields {...fields} fields={["zip"]} />}
      />
      <CountryField
        label={m.booking_details_country({}, { locale })}
        value={draft.country}
        onChange={(code) => onChange("country", code)}
        error={
          problem === undefined
            ? undefined
            : profileFieldProblemMessage("country", problem, locale)
        }
        disabled={!editable}
        locale={locale}
        ref={(node) => {
          inputs.current.set("country", node);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.lg },
  // The lookup sits right under the Company ID field it reads (boards 07b, 13b).
  companyIdLookup: { gap: space.sm },
});
