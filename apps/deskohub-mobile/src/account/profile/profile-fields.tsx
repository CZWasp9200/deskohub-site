import type { ComponentProps, RefObject } from "react";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { TextField } from "../../ui/controls";
import type {
  CompletionDraft,
  CompletionTextField,
  ProfileDraftInvalid,
  ProfileFieldProblem,
} from "./profile-draft";

/** A VAT ID's format, as the billing boards (07, 13) show it in the field. */
export const vatIdFormatExample = "CZ12345678";

type InputProps = Pick<
  ComponentProps<typeof TextField>,
  | "autoComplete"
  | "textContentType"
  | "keyboardType"
  | "autoCapitalize"
  | "maxLength"
  | "placeholder"
>;

// Lengths are the contract's limits, so typing stops where saving would fail.
const fieldInput: Record<
  CompletionTextField,
  InputProps & {
    readonly label: (locale: AppLocale) => string;
    /** The customer may leave it empty; its label says so. */
    readonly optional?: true;
    /** What the field takes, under it until it has an error. */
    readonly hint?: (locale: AppLocale) => string;
  }
> = {
  firstName: {
    label: (locale) => m.profile_first_name_label({}, { locale }),
    autoComplete: "given-name",
    textContentType: "givenName",
    autoCapitalize: "words",
    maxLength: 100,
  },
  lastName: {
    label: (locale) => m.profile_last_name_label({}, { locale }),
    optional: true,
    autoComplete: "family-name",
    textContentType: "familyName",
    autoCapitalize: "words",
    maxLength: 100,
  },
  phone: {
    label: (locale) => m.profile_phone_label({}, { locale }),
    optional: true,
    hint: (locale) => m.profile_phone_hint({}, { locale }),
    // A sample in the format the hint asks for, not a real number.
    placeholder: "+420 777 123 456",
    autoComplete: "tel",
    textContentType: "telephoneNumber",
    keyboardType: "phone-pad",
    maxLength: 32,
  },
  referralCode: {
    label: (locale) => m.profile_referral_code_label({}, { locale }),
    hint: (locale) => m.profile_referral_code_hint({}, { locale }),
    autoComplete: "off",
    autoCapitalize: "characters",
    maxLength: 64,
  },
  companyName: {
    label: (locale) => m.profile_company_name_label({}, { locale }),
    autoComplete: "organization",
    textContentType: "organizationName",
    autoCapitalize: "words",
    maxLength: 200,
  },
  companyId: {
    label: (locale) => m.profile_company_id_label({}, { locale }),
    optional: true,
    hint: (locale) => m.profile_company_id_hint({}, { locale }),
    autoComplete: "off",
    keyboardType: "number-pad",
    maxLength: 32,
  },
  vatId: {
    label: (locale) => m.profile_vat_id_label({}, { locale }),
    optional: true,
    placeholder: vatIdFormatExample,
    autoComplete: "off",
    autoCapitalize: "characters",
    maxLength: 32,
  },
  addressLine1: {
    label: (locale) => m.profile_address_line1_label({}, { locale }),
    autoComplete: "address-line1",
    textContentType: "streetAddressLine1",
    autoCapitalize: "words",
    maxLength: 200,
  },
  addressLine2: {
    label: (locale) => m.profile_address_line2_label({}, { locale }),
    optional: true,
    autoComplete: "address-line2",
    textContentType: "streetAddressLine2",
    autoCapitalize: "words",
    maxLength: 200,
  },
  city: {
    label: (locale) => m.profile_city_label({}, { locale }),
    autoComplete: "postal-address-locality",
    textContentType: "addressCity",
    autoCapitalize: "words",
    maxLength: 100,
  },
  zip: {
    label: (locale) => m.profile_zip_label({}, { locale }),
    autoComplete: "postal-code",
    textContentType: "postalCode",
    maxLength: 20,
  },
  country: {
    label: (locale) => m.profile_country_label({}, { locale }),
    autoComplete: "country",
    textContentType: "countryName",
    autoCapitalize: "characters",
    maxLength: 2,
  },
};

/** A field's label, as the form shows it above the field. */
export const profileFieldLabel = (
  field: CompletionTextField,
  locale: AppLocale
): string => fieldInput[field].label(locale);

/** What a field's problem from the last submit says, at the field. */
export const profileFieldProblemMessage = (
  field: CompletionTextField,
  problem: ProfileFieldProblem,
  locale: AppLocale
) =>
  ({
    required: () =>
      field === "companyName"
        ? m.profile_company_name_required({}, { locale })
        : m.profile_first_name_required({}, { locale }),
    "invalid-phone": () => m.profile_phone_invalid({}, { locale }),
    invalid: () =>
      field === "referralCode"
        ? m.profile_referral_code_unavailable({}, { locale })
        : m.profile_field_invalid({}, { locale }),
  })[problem]();

/** A field a form can focus: a text input, or a picker's pressable. */
export interface FocusableField {
  readonly focus: () => void;
}

/** Inputs a form can focus by field, e.g. its first invalid one. */
export type ProfileFieldRefs = RefObject<
  Map<CompletionTextField, FocusableField | null>
>;

/**
 * The text inputs for `fields` of a profile draft, each with its field's
 * problem from the last submit attempt.
 */
export function ProfileTextFields<F extends CompletionTextField>({
  fields,
  draft,
  invalid,
  onChange,
  inputs,
  editable,
  locale,
}: {
  readonly fields: ReadonlyArray<F>;
  readonly draft: Pick<CompletionDraft, F>;
  readonly invalid: ProfileDraftInvalid<CompletionTextField> | undefined;
  readonly onChange: (field: F, value: string) => void;
  readonly inputs: ProfileFieldRefs;
  readonly editable: boolean;
  readonly locale: AppLocale;
}) {
  return fields.map((field) => {
    const { label, optional, hint, ...input } = fieldInput[field];
    const problem = invalid?.fields[field];
    return (
      <TextField
        key={field}
        ref={(node) => {
          inputs.current.set(field, node);
        }}
        label={label(locale)}
        {...(optional && {
          optional: m.booking_details_optional_field({}, { locale }),
        })}
        {...(hint !== undefined && { hint: hint(locale) })}
        value={draft[field]}
        onChangeText={(value) => onChange(field, value)}
        // Greyed while a submit runs, as the boards show it (08 "Creating").
        disabled={!editable}
        error={
          problem === undefined
            ? undefined
            : profileFieldProblemMessage(field, problem, locale)
        }
        {...input}
      />
    );
  });
}
