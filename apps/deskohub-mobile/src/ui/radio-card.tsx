import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

/**
 * The look of one option in a single-choice group: a white card with a radio
 * mark, turning orange-outlined on the action tint when it is chosen. The
 * groups (`ChoiceList`, `ChoiceGroup`) own the pressable and its semantics.
 */

/** The card's style for an option's state, given its press state. */
export const radioCardStyle = ({
  checked,
  disabled,
  pressed,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly pressed: boolean;
}) => [
  styles.card,
  checked ? styles.checked : styles.unchecked,
  pressed && !disabled && !checked && styles.pressed,
  disabled && (checked ? styles.disabledChecked : styles.disabled),
];

/** The radio mark and the option's text, the card's content. */
export function RadioCardContent({
  label,
  labelLocale,
  description,
  checked,
  disabled,
}: {
  readonly label: string;
  readonly labelLocale?: AppLocale;
  readonly description?: string;
  readonly checked: boolean;
  readonly disabled: boolean;
}) {
  return (
    <>
      <RadioMark checked={checked} disabled={disabled} />
      <View style={styles.text}>
        <Text
          variant="bodyStrong"
          locale={labelLocale}
          style={disabled && styles.disabledText}
        >
          {label}
        </Text>
        {description === undefined ? null : (
          <Text variant="bodySmall" style={disabled && styles.disabledText}>
            {description}
          </Text>
        )}
      </View>
    </>
  );
}

/** The 20 dp radio: an empty ring, or an orange ring around a dot. */
export function RadioMark({
  checked,
  disabled,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
}) {
  const ink = disabled ? color.disabledInk : color.action;
  return (
    <View
      style={[
        styles.mark,
        checked
          ? { borderColor: ink }
          : disabled && { borderColor: color.disabled },
      ]}
    >
      {checked && <View style={[styles.dot, { backgroundColor: ink }]} />}
    </View>
  );
}

// The outline thickens from 1 to 2 when chosen; the padding gives back the
// difference so the content never shifts.
const outlined = (borderColor: string, borderWidth: 1 | 2) => ({
  borderColor,
  borderWidth,
  paddingHorizontal: space.lg - borderWidth,
  paddingVertical: 14 - borderWidth,
});

const markSize = 20;
const dotSize = 8;

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    backgroundColor: color.surface,
    borderRadius: radius.field,
    flexDirection: "row",
    gap: 14,
    minHeight: 56,
  },
  unchecked: outlined(color.line, 1),
  checked: { ...outlined(color.action, 2), backgroundColor: color.actionTint },
  pressed: { backgroundColor: color.pressed },
  disabled: {
    ...outlined(color.disabled, 1),
    backgroundColor: color.disabledField,
  },
  disabledChecked: {
    ...outlined(color.disabledInk, 2),
    backgroundColor: color.disabledField,
  },
  text: { flex: 1, gap: space.xxs, minWidth: 0 },
  disabledText: { color: color.disabledInk },
  mark: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.field,
    borderRadius: markSize / 2,
    borderWidth: 2,
    height: markSize,
    justifyContent: "center",
    marginTop: 1,
    width: markSize,
  },
  dot: { borderRadius: dotSize / 2, height: dotSize, width: dotSize },
  group: { gap: space.sm },
});

/** The column a group's cards stack in. */
export const radioGroupStyle = styles.group;
