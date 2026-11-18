import { type NativeStackHeaderProps, useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "../../ui/icon";
import { StackHeader } from "../../ui/navigation";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";

export const renderChooseHeader = (props: NativeStackHeaderProps) => (
  <StackHeader {...props} contentWidth="wide" />
);

/** A selection may unmount after a catalog refresh while its route stays open. */
export function useChooseHeaderFact(icon: IconComponent, text?: string) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (text === undefined) return;
    navigation.setOptions({
      headerRight: () => <ChooseHeaderFact icon={icon} text={text} />,
    });
    return () => navigation.setOptions({ headerRight: undefined });
  }, [navigation, icon, text]);
}

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
