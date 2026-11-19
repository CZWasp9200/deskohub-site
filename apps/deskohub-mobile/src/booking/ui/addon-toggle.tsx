import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon, type IconComponent } from "../../ui/icon";
import { RadioMark } from "../../ui/radio-card";
import { SwitchTrack } from "../../ui/switch";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";

/**
 * An optional extra as the website draws it: its icon and a switch on the
 * left, its price on the right. The section heading above names it; the
 * whole card is the switch.
 */
export function AddonToggle({
  label,
  icon,
  checked,
  onToggle,
  price,
  disabled = false,
}: {
  /** The extra's name, for assistive technology. */
  readonly label: string;
  readonly icon: IconComponent;
  readonly checked: boolean;
  readonly onToggle: (checked: boolean) => void;
  /** Such as "+ CZK 50". */
  readonly price: string;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => [
        styles.card,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Icon icon={icon} size={24} />
      <SwitchTrack value={checked} disabled={disabled} />
      <Text variant="label" numeric style={styles.price}>
        {price}
      </Text>
    </Pressable>
  );
}

/** One configuration of an extra, such as a monitor setup. */
export interface AddonOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean;
}

// Above this text scale a name no longer fits half the row.
const twoColumnsUpToFontScale = 1.3;

/**
 * The configurations of a switched-on extra as radio cards, two to a row
 * (one when the text is enlarged), as the website lays them out.
 */
export function AddonOptions<Value extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly options: ReadonlyArray<AddonOption<Value>>;
  readonly selected: Value | undefined;
  readonly onSelect: (value: Value) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const columns = fontScale > twoColumnsUpToFontScale ? 1 : 2;
  return (
    <View role="radiogroup" aria-label={label} style={styles.grid}>
      {options.map((option) => {
        const checked = option.value === selected;
        const disabled = option.disabled === true;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={() => onSelect(option.value)}
            style={({ pressed }) => [
              styles.option,
              columns === 2 ? styles.half : styles.whole,
              checked ? styles.checked : styles.unchecked,
              disabled && styles.disabled,
              pressed && !checked && !disabled && styles.pressed,
            ]}
          >
            <RadioMark checked={checked} disabled={disabled} />
            <Text
              variant="bodyStrong"
              style={[styles.optionLabel, disabled && styles.disabledInk]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pressed: { backgroundColor: color.pressed },
  price: { flex: 1, textAlign: "right" },
  grid: {
    columnGap: space.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: space.sm,
    rowGap: space.sm,
  },
  option: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: radius.field,
    flexDirection: "row",
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  // Two columns share the row less the gap between them.
  half: { flexBasis: "45%", flexGrow: 1 },
  whole: { flexBasis: "100%" },
  unchecked: { borderColor: color.line, borderWidth: 1 },
  checked: {
    backgroundColor: color.actionTint,
    borderColor: color.action,
    borderWidth: 2,
    paddingHorizontal: space.md - 1,
    paddingVertical: space.sm - 1,
  },
  disabled: { backgroundColor: color.disabledField },
  optionLabel: { flex: 1, minWidth: 0 },
  disabledInk: { color: color.disabledInk },
});
