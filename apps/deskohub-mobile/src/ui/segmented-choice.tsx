import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

/** One option of a `SegmentedChoice`. */
export interface SegmentedChoiceOption<Value extends string> {
  readonly value: Value;
  readonly icon: IconComponent;
  readonly label: string;
}

/**
 * A choice between a few options (`.bk-seg`): icon rows in one bordered
 * group, the chosen one tinted.
 */
export function SegmentedChoice<Value extends string>({
  label,
  options,
  selected,
  onSelect,
  disabled = false,
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly options: ReadonlyArray<SegmentedChoiceOption<Value>>;
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View role="radiogroup" aria-label={label} style={styles.segment}>
      {options.map((option, index) => {
        const on = option.value === selected;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={on}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={() => onSelect(option.value)}
            style={({ pressed }) => [
              styles.segmentOption,
              index > 0 && styles.segmentDivider,
              on && styles.segmentOn,
              pressed && !on && styles.segmentPressed,
            ]}
          >
            <Icon
              icon={option.icon}
              size={24}
              color={on ? color.action : color.navy}
            />
            <Text variant="bodyStrong" style={styles.segmentLabel}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    overflow: "hidden",
  },
  segmentOption: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  segmentDivider: { borderTopColor: color.divider, borderTopWidth: 1 },
  segmentOn: { backgroundColor: color.actionTint },
  segmentPressed: { backgroundColor: color.pressed },
  segmentLabel: { flex: 1, minWidth: 0 },
});
