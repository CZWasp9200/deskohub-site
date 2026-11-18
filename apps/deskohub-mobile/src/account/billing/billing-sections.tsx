import { StyleSheet, useWindowDimensions, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ChoiceList } from "../../ui/choice-list";
import { CountryField } from "../../ui/country-field";
import { fieldColumnStyle } from "../../ui/field";
import { FieldPair } from "../../ui/field-pair";
import { SectionHeader } from "../../ui/list";
import { space, typeScale } from "../../ui/tokens";
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
  /** The caller selects a paired layout when the available form width permits it. */
  readonly layout?: "compact" | "account" | "onboarding";
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
 * The company's name and IČO, the lookup by IČO (applied through
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
  const { draft, editable, locale, layout } = fields;
  const { fontScale } = useWindowDimensions();
  const paired = layout === "account";
  return (
    <View style={styles.section}>
      <SectionHeader title={m.billing_company_section({}, { locale })} />
      <ProfileTextFields {...fields} fields={["companyName"]} />
      <BillingCompanyLookup
        draft={draft}
        onApply={onApply}
        disabled={!editable}
        remindsToSave={remindsToSave}
        locale={locale}
        renderAction={(action) => (
          <View style={paired ? styles.lookupPair : styles.stackedLookup}>
            <View style={paired && styles.column}>
              <ProfileTextFields {...fields} fields={["companyId"]} />
            </View>
            <View
              style={
                paired && [
                  styles.lookupAction,
                  // Align with the input under its label.
                  {
                    marginTop:
                      typeScale.label.lineHeight * fontScale +
                      fieldColumnStyle.gap,
                  },
                ]
              }
            >
              {action}
            </View>
          </View>
        )}
      />
      <View style={paired && styles.halfWidth}>
        <ProfileTextFields {...fields} fields={["vatId"]} />
      </View>
    </View>
  );
}

/** The street and city pairs, followed by the country picker. */
export function BillingAddressSection(fields: BillingFieldProps) {
  const {
    draft,
    onChange,
    locale,
    invalid,
    editable,
    inputs,
    layout = "compact",
  } = fields;
  const problem = invalid?.fields.country;
  const paired = layout !== "compact";
  return (
    <View style={styles.section}>
      <SectionHeader title={m.billing_address_section({}, { locale })} />
      <View style={paired ? styles.pair : styles.section}>
        <View style={paired && styles.column}>
          <ProfileTextFields {...fields} fields={["addressLine1"]} />
        </View>
        <View style={paired && styles.column}>
          <ProfileTextFields {...fields} fields={["addressLine2"]} />
        </View>
      </View>
      {paired ? (
        <View style={styles.pair}>
          <View style={styles.column}>
            <ProfileTextFields {...fields} fields={["city"]} />
          </View>
          <View style={styles.column}>
            <ProfileTextFields {...fields} fields={["zip"]} />
          </View>
        </View>
      ) : (
        <FieldPair
          wide={<ProfileTextFields {...fields} fields={["city"]} />}
          narrow={<ProfileTextFields {...fields} fields={["zip"]} />}
        />
      )}
      <View style={layout === "account" && styles.halfWidth}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.lg },
  pair: { flexDirection: "row", gap: space.md },
  column: { flex: 1, minWidth: 0 },
  halfWidth: { width: "50%" },
  stackedLookup: { gap: space.sm },
  lookupPair: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.sm,
  },
  lookupAction: { width: "38%" },
});
