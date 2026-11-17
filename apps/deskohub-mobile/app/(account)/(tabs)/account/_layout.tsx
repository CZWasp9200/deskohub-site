import { Stack } from "expo-router";
import { accountStackAnchor } from "../../../../src/account/account-root";
import { SignOutButton } from "../../../../src/account/sign-out-button";
import { useAppLocale } from "../../../../src/i18n/locale-context";
import { m } from "../../../../src/i18n/messages";
import { stackScreenOptions } from "../../../../src/ui/navigation";

const renderSignOutButton = () => <SignOutButton />;

// A link straight to a section, such as billing or referrals, keeps the
// Account root behind it for Back (see `accountStackAnchor`).
export const unstable_settings = { anchor: accountStackAnchor };

export default function AccountSectionsLayout() {
  const locale = useAppLocale();
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="index"
        options={{
          title: m.account_tab_account({}, { locale }),
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="profile"
        options={{
          title: m.account_section_profile({}, { locale }),
          // Checkout's own route to the profile leaves it out.
          headerRight: renderSignOutButton,
        }}
      />
      <Stack.Screen
        name="language"
        options={{ title: m.account_section_language({}, { locale }) }}
      />
      <Stack.Screen
        name="billing"
        options={{ title: m.account_section_billing({}, { locale }) }}
      />
      <Stack.Screen
        name="invoices"
        options={{ title: m.account_section_invoices({}, { locale }) }}
      />
      <Stack.Screen
        name="security"
        options={{ title: m.account_section_security({}, { locale }) }}
      />
      <Stack.Screen
        name="assistants"
        options={{ title: m.account_section_assistants({}, { locale }) }}
      />
      <Stack.Screen
        name="legal"
        options={{ title: m.account_section_legal({}, { locale }) }}
      />
      <Stack.Screen
        name="referrals"
        options={{ title: m.account_section_referrals({}, { locale }) }}
      />
      <Stack.Screen
        name="danger"
        options={{ title: m.account_section_danger({}, { locale }) }}
      />
    </Stack>
  );
}
