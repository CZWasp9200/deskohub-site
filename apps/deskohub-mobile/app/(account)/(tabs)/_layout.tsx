import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Tabs } from "expo-router";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleUser from "lucide-react-native/icons/circle-user";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { useBackToStartTab } from "../../../src/routing/back-to-start-tab";
import { startTabAtom } from "../../../src/routing/start-tab";
import { tabScreenOptions } from "../../../src/ui/navigation";
import { TabBar, type TabBarItem } from "../../../src/ui/tab-bar";

const tabItems: Readonly<Record<string, TabBarItem>> = {
  account: { icon: CircleUser },
  book: { icon: CalendarPlus, raised: true },
  reservations: { icon: CalendarCheck },
};

/**
 * Account, Book and Reservations, each its own stack. The app opens on the
 * start tab (see `startTabAtom` and the `/` route), and system back from
 * another tab's root returns to it before leaving the app.
 */
export default function AccountTabsLayout() {
  const locale = useAppLocale();
  const startTab = useAtomValue(startTabAtom);
  useBackToStartTab(
    AsyncResult.isSuccess(startTab) ? startTab.value : undefined
  );
  return (
    <Tabs
      backBehavior="none"
      screenOptions={tabScreenOptions}
      tabBar={(props) => <TabBar {...props} items={tabItems} />}
    >
      <Tabs.Screen
        name="account"
        options={{ title: m.account_tab_account({}, { locale }) }}
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
