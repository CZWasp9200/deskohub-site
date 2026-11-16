import { Stack } from "expo-router";
import { useAppLocale } from "../../../../src/i18n/locale-context";
import { m } from "../../../../src/i18n/messages";
import { stackScreenOptions } from "../../../../src/ui/navigation";

/**
 * The Book tab: the choice of spaces under its masthead. Booking a space
 * opens above the tabs (`(account)/book`), where the tab bar is hidden.
 */
export default function BookTabLayout() {
  const locale = useAppLocale();
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="index"
        options={{
          title: m.booking_stack_title({}, { locale }),
          headerShown: false,
        }}
      />
    </Stack>
  );
}
