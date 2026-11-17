import { Option } from "effect";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import Plus from "lucide-react-native/icons/plus";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { ScrollScreen } from "../../ui/scroll-screen";
import { color, space } from "../../ui/tokens";
import { LoginEmailCard } from "../profile/login-email-card";
import { identityFields } from "../profile/profile-draft";
import { ProfileTextFields } from "../profile/profile-fields";
import { invalidOf, useFocusFirstInvalid } from "../profile/profile-form";
import { ProfileSubmitState } from "../profile/profile-save";
import {
  type CompletionRequiredAccount,
  useOnboardingDraft,
} from "./onboarding-draft";
import { OnboardingFooter } from "./onboarding-footer";
import { OnboardingGate } from "./onboarding-gate";
import { aboutYouFields, aboutYouRefusal } from "./onboarding-model";
import { onboardingBillingHref } from "./onboarding-routes";
import { OnboardingStepHead } from "./onboarding-step-head";

/**
 * Onboarding's first step, About you (board 06): the verified login email,
 * name and phone, and a referral code behind "Add a referral code".
 * Continue points at a field to fix before moving on; nothing is sent
 * until the billing step.
 */
export function AboutYouScreen() {
  return (
    <OnboardingGate>
      {(account) => <AboutYouForm account={account} />}
    </OnboardingGate>
  );
}

function AboutYouForm({
  account,
}: {
  readonly account: CompletionRequiredAccount;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const draft = useOnboardingDraft(account);
  // Continue's own refusal, else the final submit's when it named fields
  // here; the submit's progress and failure belong to the billing step.
  const [refusal, setRefusal] = useState<ProfileSubmitState>();
  const state =
    refusal ??
    (draft.state._tag === "Invalid" ? draft.state : ProfileSubmitState.Idle());
  const fields = aboutYouFields(account.referralsEnabled);
  const { inputs } = useFocusFirstInvalid(state, fields);
  const invalid = invalidOf(state);
  // Shown from the start when the invitation prefilled a code, and kept
  // open once shown, so clearing it doesn't hide the field being typed in.
  const [referralOpened, setReferralOpened] = useState(
    () => draft.draft.referralCode !== ""
  );
  const [referralFocus, setReferralFocus] = useState(false);
  const referralShown =
    account.referralsEnabled &&
    (referralOpened || invalid?.fields.referralCode !== undefined);
  const submitting = draft.state._tag === "Submitting";

  // The field "Add a referral code" opens takes the focus.
  useEffect(() => {
    if (referralFocus) inputs.current.get("referralCode")?.focus();
  }, [referralFocus, inputs]);

  const setField = (
    field: Parameters<typeof draft.setField>[0],
    value: string
  ) => {
    setRefusal(undefined);
    draft.setField(field, value);
  };
  const onContinue = () => {
    // A new attempt: the last submit's refusal no longer sends anyone back.
    draft.resetSubmit();
    Option.match(
      aboutYouRefusal({
        draft: draft.draft,
        invitationCode: draft.invitationCode,
        phoneRegion: draft.phoneRegion,
        referralsEnabled: account.referralsEnabled,
      }),
      {
        onNone: () => {
          setRefusal(undefined);
          router.push(onboardingBillingHref);
        },
        onSome: (invalid) =>
          setRefusal(ProfileSubmitState.Invalid({ invalid, attempt: {} })),
      }
    );
  };
  const textFields = {
    draft: draft.draft,
    invalid,
    onChange: setField,
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
          step="about-you"
          title={m.onboarding_about_you_title({}, { locale })}
          intro={m.onboarding_about_you_intro({}, { locale })}
          locale={locale}
        />
        <LoginEmailCard email={account.email} compact />
        <View style={styles.fields}>
          <ProfileTextFields {...textFields} fields={identityFields} />
          {referralShown && (
            <ProfileTextFields {...textFields} fields={["referralCode"]} />
          )}
        </View>
        {account.referralsEnabled && !referralShown && (
          <View style={styles.addReferral}>
            <Button
              variant="text"
              size="small"
              icon={Plus}
              label={m.onboarding_add_referral_code({}, { locale })}
              onPress={() => {
                setReferralOpened(true);
                setReferralFocus(true);
              }}
              disabled={submitting}
            />
          </View>
        )}
      </ScrollScreen>
      <OnboardingFooter
        step="about-you"
        state={state}
        shownFields={fields}
        label={m.profile_complete_continue({}, { locale })}
        busyLabel={m.profile_complete_submitting({}, { locale })}
        onPress={onContinue}
        locale={locale}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  fields: { gap: space.lg },
  addReferral: { alignItems: "flex-start" },
});
