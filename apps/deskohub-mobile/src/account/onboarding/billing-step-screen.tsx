import { Option } from "effect";
import { useIsFocused, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect } from "react";
import { KeyboardAvoidingView, StyleSheet } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ScrollScreen } from "../../ui/scroll-screen";
import { color } from "../../ui/tokens";
import { billingSectionsOf } from "../billing/billing-form-model";
import {
  BillingAddressSection,
  BillingChoices,
  BillingCompanySection,
} from "../billing/billing-sections";
import { billingFieldsOf } from "../profile/profile-draft";
import { invalidOf, useFocusFirstInvalid } from "../profile/profile-form";
import {
  type CompletionRequiredAccount,
  useOnboardingDraft,
} from "./onboarding-draft";
import { OnboardingFooter } from "./onboarding-footer";
import { OnboardingGate } from "./onboarding-gate";
import { stepOfInvalid } from "./onboarding-model";
import { OnboardingStepHead } from "./onboarding-step-head";

/**
 * Onboarding's second step, Billing details (board 07), with the same
 * sections as Account › Billing details, IČO lookup included. Create
 * profile submits both steps' answers once; when the first field to fix
 * is on About you, the customer goes back there to fix it.
 */
export function BillingStepScreen() {
  return (
    <OnboardingGate>
      {(account) => <BillingStepForm account={account} />}
    </OnboardingGate>
  );
}

function BillingStepForm({
  account,
}: {
  readonly account: CompletionRequiredAccount;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const focused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const draft = useOnboardingDraft(account);
  const kind = draft.draft.billingKind;
  const fields = billingFieldsOf(kind);
  const sections = billingSectionsOf(kind);
  const { inputs } = useFocusFirstInvalid(draft.state, fields);
  const submitting = draft.state._tag === "Submitting";
  const refusal = draft.state._tag === "Invalid" ? draft.state : undefined;
  const backToAboutYou =
    refusal !== undefined &&
    Option.contains(stepOfInvalid(refusal.invalid), "about-you");
  const attempt = refusal?.attempt;

  // About you shows and focuses the field to fix.
  useEffect(() => {
    if (focused && backToAboutYou && attempt !== undefined) router.back();
  }, [focused, backToAboutYou, attempt, router]);

  const billingFields = {
    draft: draft.draft,
    invalid: invalidOf(draft.state),
    onChange: draft.setField,
    inputs,
    editable: !submitting,
    locale,
  };
  return (
    <KeyboardAvoidingView
      behavior="padding"
      // The view's frame starts under the stack header.
      keyboardVerticalOffset={headerHeight}
      style={styles.screen}
    >
      <ScrollScreen>
        <OnboardingStepHead
          step="billing"
          title={m.profile_billing_details_section({}, { locale })}
          locale={locale}
        />
        <BillingChoices
          selected={kind}
          onSelect={(billingKind) => draft.change({ billingKind })}
          disabled={submitting}
          locale={locale}
        />
        {sections.company && (
          <BillingCompanySection {...billingFields} onApply={draft.change} />
        )}
        {sections.address && <BillingAddressSection {...billingFields} />}
      </ScrollScreen>
      <OnboardingFooter
        step="billing"
        state={draft.state}
        shownFields={fields}
        label={m.profile_complete_submit({}, { locale })}
        busyLabel={m.profile_complete_submitting({}, { locale })}
        onPress={draft.submit}
        locale={locale}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
});
