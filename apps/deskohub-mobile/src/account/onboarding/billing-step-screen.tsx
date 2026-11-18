import { Option } from "effect";
import { useIsFocused, useNavigation, useRoute, useRouter } from "expo-router";
import type {
  NavigationProp,
  ParamListBase,
} from "expo-router/react-navigation";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ScrollScreen } from "../../ui/scroll-screen";
import { color, space } from "../../ui/tokens";
import { QuietUpdateOffer } from "../../updates/update-offer-card";
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
import { useOnboardingLayout } from "./onboarding-layout";
import { stepOfInvalid } from "./onboarding-model";
import { aboutYouBelow, onboardingHref } from "./onboarding-routes";
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
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
  const focused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const { isWide, pairFields } = useOnboardingLayout();
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

  // About you shows and focuses the field to fix: back to it, or to a new
  // About you when this step was opened on its own.
  useEffect(() => {
    if (!(focused && backToAboutYou && attempt !== undefined)) return;
    const stack = navigation.getState();
    if (stack !== undefined && aboutYouBelow(stack, route.key))
      navigation.goBack();
    else router.replace(onboardingHref);
  }, [focused, backToAboutYou, attempt, navigation, route.key, router]);

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
        <QuietUpdateOffer backdrop="paper" />
        <OnboardingStepHead
          step="billing"
          title={m.profile_billing_details_section({}, { locale })}
          locale={locale}
          wide={isWide}
        />
        <View style={isWide ? styles.wideSections : styles.sections}>
          <BillingChoices
            selected={kind}
            onSelect={(billingKind) => draft.change({ billingKind })}
            disabled={submitting}
            locale={locale}
          />
          {sections.company && (
            <BillingCompanySection
              {...billingFields}
              onApply={draft.change}
              remindsToSave={false}
            />
          )}
          {sections.address && (
            <BillingAddressSection
              {...billingFields}
              layout={pairFields ? "onboarding" : undefined}
            />
          )}
        </View>
      </ScrollScreen>
      <OnboardingFooter
        step="billing"
        state={draft.state}
        shownFields={fields}
        label={m.profile_complete_submit({}, { locale })}
        busyLabel={m.profile_complete_submitting({}, { locale })}
        onPress={draft.submit}
        locale={locale}
        wide={isWide}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  sections: { gap: space.md },
  wideSections: { gap: space.xxl },
});
