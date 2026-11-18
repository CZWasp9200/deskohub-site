import type { NativeStackHeaderProps } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "../../ui/icon";
import { StackHeader } from "../../ui/navigation";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";

export const renderChooseHeader = (props: NativeStackHeaderProps) => (
  <StackHeader {...props} contentWidth="wide" />
);

export function ChooseHeaderFact({
  icon,
  text,
}: {
  readonly icon: IconComponent;
  readonly text: string;
}) {
  return (
    <View style={styles.fact}>
      <Icon icon={icon} size={16} color={color.ink2} />
      <Text variant="hint" tone="muted" style={styles.text}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fact: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: space.xs,
  },
  text: { flexShrink: 1 },
});
