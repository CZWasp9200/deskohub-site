import { Stack } from "expo-router";
import { accessStackHeader } from "../../../src/account/reservations/access-screen";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { stackScreenOptions } from "../../../src/ui/navigation";

/**
 * A reservation's screens that open above the tabs, so the tab bar is
 * hidden: the access PIN, from the booking view, the list's next booking,
 * or a link. The list and the booking view are the Reservations tab
 * (`(tabs)/reservations`), where Back goes from a PIN a link opened with
 * nothing behind it (`accessStackHeader`).
 */
export default function ReservationScreensLayout() {
  const locale = useAppLocale();
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="[orderId]/access"
        options={{
          title: m.reservations_access_title({}, { locale }),
          header: accessStackHeader.navy,
        }}
      />
    </Stack>
  );
}
