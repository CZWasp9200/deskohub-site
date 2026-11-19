import {
  Stack,
  useNavigationContainerRef,
  useRouter,
  useSegments,
} from "expo-router";
import { CommonActions } from "expo-router/react-navigation";
import {
  type AccountDetailSection,
  accountDetailSection,
  accountSectionHref,
} from "../../../../src/account/account-gating";
import { AccountIndexScreen } from "../../../../src/account/account-index-screen";
import {
  accountSectionReset,
  accountStackAnchor,
  isProfileEditor,
} from "../../../../src/account/account-root";
import { SignOutButton } from "../../../../src/account/sign-out-button";
import { useAppLocale } from "../../../../src/i18n/locale-context";
import { m } from "../../../../src/i18n/messages";
import { stackScreenOptions } from "../../../../src/ui/navigation";
import { SplitPane } from "../../../../src/ui/split-pane";
import { useViewport } from "../../../../src/ui/viewport";

const renderSignOutButton = () => <SignOutButton />;

// A link straight to a section, such as billing or referrals, keeps the
// Account root behind it for Back (see `accountStackAnchor`).
export const unstable_settings = { anchor: accountStackAnchor };

export default function AccountSectionsLayout() {
  const locale = useAppLocale();
  const { isExpanded } = useViewport();
  const activeSection = accountDetailSection(useSegments());
  const showsList = isExpanded && activeSection !== undefined;
  const router = useRouter();
  const navigation = useNavigationContainerRef();
  const openSection = (section: AccountDetailSection) => {
    if (activeSection === undefined || activeSection === section) return;
    if (isProfileEditor(activeSection) && !isProfileEditor(section)) {
      const reset = accountSectionReset(navigation.getRootState(), section);
      if (reset !== undefined) {
        navigation.dispatch({
          ...CommonActions.reset(reset.state),
          target: reset.target,
        });
      }
      return;
    }
    router.navigate(accountSectionHref[section], { dangerouslySingular: true });
  };
  return (
    <SplitPane
      enabled={showsList}
      list={
        showsList && (
          <AccountIndexScreen menu={{ activeSection, openSection }} />
        )
      }
    >
      <Stack
        screenOptions={{
          ...stackScreenOptions(locale),
          headerBackVisible: !showsList,
        }}
      >
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
            headerRight: showsList ? undefined : renderSignOutButton,
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
    </SplitPane>
  );
}
