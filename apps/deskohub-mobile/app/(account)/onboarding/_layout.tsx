import { Stack } from "expo-router";
import { completeProfileAtom } from "../../../src/account/profile/profile-save";
import { useSettledResultReset } from "../../../src/customer-api/settled-result-reset";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import {
  renderClosingStackHeader,
  stackScreenOptions,
} from "../../../src/ui/navigation";

/**
 * Completing the profile, above the tabs so it opens over the tab the
 * customer is on and the tab bar is hidden: About you (closes onboarding),
 * Billing details (back to About you), and the finish, which replaces the
 * steps and has no app bar.
 */
export default function OnboardingLayout() {
  const locale = useAppLocale();
  // The steps share one submit; it is forgotten once onboarding closes.
  useSettledResultReset(completeProfileAtom);
  const title = m.account_section_complete({}, { locale });
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="index"
        options={{ title, header: renderClosingStackHeader }}
      />
      <Stack.Screen name="billing" options={{ title }} />
      <Stack.Screen name="done" options={{ headerShown: false }} />
    </Stack>
  );
}
