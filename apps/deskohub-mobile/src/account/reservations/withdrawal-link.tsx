import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useRouter } from "expo-router";
import { type StyleProp, StyleSheet, type TextStyle } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";

/**
 * The always-visible withdrawal control (§1830a(2)): a small rose link to the
 * confirm step. `underlined` where it sits with the reservation's actions.
 */
export function WithdrawalLink({
  orderId,
  underlined = false,
  style,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly underlined?: boolean;
  readonly style?: StyleProp<TextStyle>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <Text
      role="link"
      variant="hint"
      onPress={() =>
        router.push({
          pathname: "/reservations/[orderId]/withdraw",
          params: { orderId },
        })
      }
      suppressHighlighting
      hitSlop={space.sm}
      style={[styles.link, underlined && styles.underlined, style]}
    >
      {m.reservations_withdraw({}, { locale })}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { color: color.danger },
  underlined: { textDecorationLine: "underline" },
});
