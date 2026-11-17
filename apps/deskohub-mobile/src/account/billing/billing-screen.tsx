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
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { SectionHeader } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { useToast } from "../../ui/toast";
import { color, space } from "../../ui/tokens";
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
  useProfileForm,
} from "../profile/profile-form";
import { ProfileFormFooter } from "../profile/profile-form-footer";
import { ReturnToAccountRoot } from "../return-to-account-root";
import { billingFormView } from "./billing-form-model";
import {
  BillingAddressSection,
  BillingChoices,
  BillingCompanySection,
  type BillingFieldProps,
} from "./billing-sections";

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
                <BillingChoices
                  selected={form.draft.billingKind}
                  onSelect={form.setBillingKind}
                  disabled={saving}
                  locale={locale}
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
                <BillingCompanySection
                  {...fields}
                  onApply={form.change}
                  remindsToSave
                />
              )}
              {view.address && <BillingAddressSection {...fields} />}
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

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  section: { gap: space.lg },
});
