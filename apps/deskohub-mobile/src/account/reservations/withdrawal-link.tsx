import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useRouter } from "expo-router";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";
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
  /** Places the link; it is as wide as its label. */
  readonly style?: StyleProp<ViewStyle>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <Pressable
      role="link"
      onPress={() =>
        router.push({
          pathname: "/reservations/[orderId]/withdraw",
          params: { orderId },
        })
      }
      hitSlop={space.sm}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <Text
        variant="hint"
        style={[styles.link, underlined && styles.underlined]}
      >
        {m.reservations_withdraw({}, { locale })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { color: color.danger },
  underlined: { textDecorationLine: "underline" },
  pressed: { opacity: 0.7 },
});
