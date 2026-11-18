import { Stack } from "expo-router";
import { View } from "react-native";
import { useAppLocale } from "../../../../src/i18n/locale-context";
import { m } from "../../../../src/i18n/messages";
import { Text } from "../../../../src/ui/text";
import { color, space } from "../../../../src/ui/tokens";

/** Placeholder for the withdrawal confirm step (designed in screen 06). */
export default function ReservationWithdrawRoute() {
  const locale = useAppLocale();
  return (
    <View style={{ flex: 1, backgroundColor: color.paper, padding: space.lg }}>
      <Stack.Screen
        options={{ title: m.reservations_withdraw_title({}, { locale }) }}
      />
      <Text variant="bodySmall">
        {m.reservations_withdraw_title({}, { locale })}
      </Text>
    </View>
  );
}
