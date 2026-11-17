import Clock from "lucide-react-native/icons/clock";
import { StyleSheet, View } from "react-native";
import { Icon } from "../../ui/icon";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";

/**
 * When an overnight stay starts and ends, under the date it was chosen on:
 * an orange clock, then the arrival and departure dates and times in grey.
 */
export function OvernightStayTimes({ times }: { readonly times: string }) {
  return (
    <View style={styles.row}>
      <Icon icon={Clock} size={18} color={color.action} />
      <Text variant="bodySmall" tone="muted" style={styles.text}>
        {times}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.md,
  },
  text: { flexShrink: 1 },
});
