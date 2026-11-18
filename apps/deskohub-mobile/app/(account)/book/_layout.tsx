import { Stack } from "expo-router";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { stackScreenOptions } from "../../../src/ui/navigation";
import { useUpdateOfferHost } from "../../../src/updates/update-offer";

/**
 * Booking a space and its checkout, above the tabs so the tab bar is
 * hidden. The choice of spaces is the Book tab (`(tabs)/book`).
 */
export default function BookLayout() {
  const locale = useAppLocale();
  // The whole flow is critical: its screens show the quiet update card, and
  // the banner stays away even while one loads or fails.
  useUpdateOfferHost();
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="cowork"
        options={{ title: m.booking_family_cowork_title({}, { locale }) }}
      />
      <Stack.Screen
        name="meeting-room"
        options={{ title: m.booking_family_meeting_room_title({}, { locale }) }}
      />
      <Stack.Screen
        name="office"
        options={{ title: m.booking_family_office_title({}, { locale }) }}
      />
      <Stack.Screen
        name="checkout"
        options={{ title: m.booking_stack_checkout_title({}, { locale }) }}
      />
      <Stack.Screen
        name="profile"
        options={{ title: m.account_section_profile({}, { locale }) }}
      />
    </Stack>
  );
}
