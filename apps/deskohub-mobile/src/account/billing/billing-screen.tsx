import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ChoiceList } from "../../ui/choice-list";
import { CountryField } from "../../ui/country-field";
import { FieldPair } from "../../ui/field-pair";
import { SectionHeader } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { useToast } from "../../ui/toast";
import { color, space } from "../../ui/tokens";
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
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
  useProfileForm,
} from "../profile/profile-form";
import { ProfileFormFooter } from "../profile/profile-form-footer";
import { ReturnToAccountRoot } from "../return-to-account-root";
import { BillingCompanyLookup } from "./billing-company-lookup";
import { billingChoiceOrder, billingFormView } from "./billing-form-model";

type LinkedAccount = Extract<CustomerAccountState, { kind: "linked" }>;

/**
 * Billing details: who invoices go to (nobody, the customer, or a company)
 * and the billing address, edited in the same profile draft as the Profile
 * screen and saved whole from a footer that stays above the keyboard (the
 * tab layout hides the tab bar here, see `tabBarHidden`). Choosing No
 * billing details warns before a save removes the saved ones.
 */
export function BillingScreen() {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const linked = Option.filter(
    AsyncResult.value(account),
    (current): current is LinkedAccount => current.kind === "linked"
  );
  if (Option.isSome(linked))
    return (
      <BillingForm
        account={linked.value}
        result={account}
        onRefresh={refresh}
      />
    );
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      <AsyncView result={account} onRetry={refresh}>
        {/* The Account tab explains why an account without a profile can't edit it. */}
        {() => <ReturnToAccountRoot />}
      </AsyncView>
    </ScrollScreen>
  );
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

function BillingForm({
  account,
  result,
  onRefresh,
}: {
  readonly account: LinkedAccount;
  readonly result: Atom.Type<typeof accountAtom>;
  readonly onRefresh: () => void;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const toast = useToast();
  const headerHeight = useHeaderHeight();
  const form = useProfileForm(account);
  const view = billingFormView(account.profile, form.draft);
  const { inputs } = useFocusFirstInvalid(form.state, view.fields);
  const saving = form.state._tag === "Submitting";
  const saved = form.state._tag === "Done";

  useEffect(() => {
    if (saved) toast.show({ message: m.billing_saved({}, { locale }) });
  }, [saved, toast, locale]);

  const fields: BillingFieldProps = {
    draft: form.draft,
    invalid: invalidOf(form.state),
    onChange: form.setField,
    inputs,
    editable: !saving,
    locale,
  };
  return (
    <KeyboardAvoidingView
      behavior="padding"
      // The view's frame starts under the stack header.
      keyboardVerticalOffset={headerHeight}
      style={styles.screen}
    >
      <UnsavedChangesGuard
        unsaved={form.unsaved}
        onDiscard={form.discard}
        sharedWith={["profile"]}
        locale={locale}
      />
      <ScrollScreen refreshing={result.waiting} onRefresh={onRefresh}>
        <AsyncView result={result} onRetry={onRefresh}>
          {() => (
            <>
              <View style={styles.section}>
                <SectionHeader
                  first
                  title={m.billing_invoices_go_to({}, { locale })}
                />
                <ChoiceList
                  label={m.billing_invoices_go_to({}, { locale })}
                  choices={billingChoiceOrder.map((choice) => ({
                    value: choice,
                    label: choiceLabel(choice, locale),
                    description: choiceDescription(choice, locale),
                  }))}
                  selected={form.draft.billingKind}
                  onSelect={form.setBillingKind}
                  disabled={saving}
                />
                {/* Kept mounted so assistive tech announces it. */}
                <Notice
                  tone="warning"
                  message={
                    view.removesSavedBilling
                      ? m.billing_removes_saved({}, { locale })
                      : undefined
                  }
                />
              </View>
              {view.company && (
                <View style={styles.section}>
                  <SectionHeader
                    title={m.billing_company_section({}, { locale })}
                  />
                  <ProfileTextFields
                    {...fields}
                    fields={["companyName", "companyId"]}
                  />
                  <BillingCompanyLookup
                    draft={form.draft}
                    onApply={form.change}
                    disabled={saving}
                    locale={locale}
                  />
                  <ProfileTextFields {...fields} fields={["vatId"]} />
                </View>
              )}
              {view.address && (
                <AddressSection
                  {...fields}
                  country={form.draft.country}
                  onCountry={(code) => form.setField("country", code)}
                />
              )}
            </>
          )}
        </AsyncView>
      </ScrollScreen>
      <ProfileFormFooter
        state={form.state}
        unsaved={form.unsaved}
        shownFields={view.fields}
        onSave={form.save}
        elsewhere={{
          message: m.profile_invalid_on_profile({}, { locale }),
          label: m.account_section_profile({}, { locale }),
          onPress: () => router.push("/account/profile"),
        }}
        locale={locale}
      />
    </KeyboardAvoidingView>
  );
}

/** The props every `ProfileTextFields` of the billing form shares. */
interface BillingFieldProps {
  readonly draft: ProfileDraft;
  readonly invalid: ProfileDraftInvalid<CompletionTextField> | undefined;
  readonly onChange: (field: ProfileTextField, value: string) => void;
  readonly inputs: ProfileFieldRefs;
  readonly editable: boolean;
  readonly locale: AppLocale;
}

/** Street and apartment, then city and postal code side by side, then the country. */
function AddressSection({
  country,
  onCountry,
  ...fields
}: BillingFieldProps & {
  readonly country: string;
  readonly onCountry: (code: string) => void;
}) {
  const { locale, invalid, editable } = fields;
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
        value={country}
        onChange={onCountry}
        error={
          problem === undefined
            ? undefined
            : profileFieldProblemMessage("country", problem, locale)
        }
        disabled={!editable}
        locale={locale}
        ref={(node) => {
          fields.inputs.current.set("country", node);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  section: { gap: space.lg },
});
