import { Tabs } from "expo-router";
import { getFocusedRouteNameFromRoute } from "expo-router/react-navigation";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { tabBarHidden } from "../../../src/routing/tab-bar-visibility";
import { tabScreenOptions } from "../../../src/ui/navigation";

/** The Reservations and Account tabs, each its own stack. */
export default function AccountTabsLayout() {
  const locale = useAppLocale();
  return (
    <Tabs screenOptions={tabScreenOptions(locale)}>
      <Tabs.Screen
        name="reservations"
        options={{ title: m.account_tab_reservations({}, { locale }) }}
      />
      <Tabs.Screen
        name="account"
        options={({ route }) => ({
          title: m.account_tab_account({}, { locale }),
          ...(tabBarHidden("account", getFocusedRouteNameFromRoute(route)) && {
            tabBarStyle: { display: "none" },
          }),
        })}
      />
    </Tabs>
  );
}
