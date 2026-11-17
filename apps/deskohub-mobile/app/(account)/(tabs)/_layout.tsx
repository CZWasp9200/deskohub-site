import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { Tabs } from "expo-router";
import { getFocusedRouteNameFromRoute } from "expo-router/react-navigation";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleUser from "lucide-react-native/icons/circle-user";
import { accountTabOptions } from "../../../src/account/account-root";
import { accountAtom } from "../../../src/customer-api/customer-data-runtime";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { useBackToStartTab } from "../../../src/routing/back-to-start-tab";
import { startTabAtom } from "../../../src/routing/start-tab";
import { tabBarHidden } from "../../../src/routing/tab-bar-visibility";
import { tabScreenOptions } from "../../../src/ui/navigation";
import { TabBar, type TabBarItem } from "../../../src/ui/tab-bar";

/** The tabs' icons; Account carries a dot while the profile isn't finished. */
const tabItems = (
  profileMissing: boolean
): Readonly<Record<string, TabBarItem>> => ({
  account: { icon: CircleUser, dot: profileMissing },
  book: { icon: CalendarPlus, raised: true },
  reservations: { icon: CalendarCheck },
});

/**
 * Account, Book and Reservations, each its own stack. The app opens on the
 * start tab (see `startTabAtom` and the `/` route), and system back from
 * another tab's root returns to it before leaving the app.
 */
export default function AccountTabsLayout() {
  const locale = useAppLocale();
  const startTab = useAtomValue(startTabAtom);
  const profileMissing = Option.exists(
    AsyncResult.value(useAtomValue(accountAtom)),
    (account) => account.kind === "completion-required"
  );
  const items = tabItems(profileMissing);
  useBackToStartTab(
    AsyncResult.isSuccess(startTab) ? startTab.value : undefined
  );
  return (
    <Tabs
      backBehavior="none"
      screenOptions={tabScreenOptions}
      tabBar={(props) => {
        // A form with its own sticky footer, such as the profile, hides the
        // bar while it shows (see `tabBarHidden`).
        const tab = props.state.routes[props.state.index];
        return (
          <TabBar
            {...props}
            items={items}
            hidden={
              tab !== undefined &&
              tabBarHidden(tab.name, getFocusedRouteNameFromRoute(tab))
            }
          />
        );
      }}
    >
      <Tabs.Screen
        name="account"
        options={{
          ...accountTabOptions,
          title: m.account_tab_account({}, { locale }),
        }}
      />
      <Tabs.Screen
        name="book"
        options={{ title: m.booking_stack_title({}, { locale }) }}
      />
      <Tabs.Screen
        name="reservations"
        options={{ title: m.account_tab_reservations({}, { locale }) }}
      />
    </Tabs>
  );
}
