import { brandFontVariation } from "@deskohub/brand-tokens";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "../../ui/icon";
import { Text } from "../../ui/text";
import { color, space, touchTarget, typeScale } from "../../ui/tokens";
import { stepperModel } from "./stepper-model";

/** How the line under a stepper's label reads: grey, or in warning ink at a limit. */
export type StepperHintTone = "muted" | "warning";

/**
 * A whole number picked within `min..max` with round − and + buttons, as a
 * row (`.bk-stp`): its label with one line under it (`hint`, such as what
 * the value means or the limit it has reached), then the controls. Screen
 * readers adjust it as one control with their increment and decrement
 * gestures and hear the hint with the value.
 */
export function Stepper({
  label,
  hint,
  hintTone = "muted",
  value,
  min,
  max,
  onChange,
  decrementLabel,
  incrementLabel,
  formatValue = String,
  disabled = false,
}: {
  readonly label: string;
  /** The line under the label; none draws the label alone. */
  readonly hint?: string;
  readonly hintTone?: StepperHintTone;
  readonly value: number;
  readonly min: number;
  /** Below `min` when nothing can be chosen, which disables both buttons. */
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly decrementLabel: string;
  readonly incrementLabel: string;
  /** The visible and announced value; `String(value)` by default. */
  readonly formatValue?: (value: number) => string;
  readonly disabled?: boolean;
}) {
  const stepper = stepperModel({ value, min, max });
  const canDecrement = !disabled && stepper.canDecrement;
  const canIncrement = !disabled && stepper.canIncrement;
  const step = (by: number) => onChange(stepper.clamp(value + by));
  const valueText = formatValue(value);
  const shownHint = hint !== undefined && hint !== "" ? hint : undefined;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min,
        max,
        now: value,
        text:
          shownHint === undefined ? valueText : `${valueText}, ${shownHint}`,
      }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "decrement" }, { name: "increment" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "decrement" && canDecrement) step(-1);
        if (nativeEvent.actionName === "increment" && canIncrement) step(1);
      }}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {shownHint !== undefined && (
          <Text style={[styles.hint, hintTone === "warning" && styles.warning]}>
            {shownHint}
          </Text>
        )}
      </View>
      <View style={styles.controls}>
        <StepButton
          label={decrementLabel}
          icon={Minus}
          disabled={!canDecrement}
          onPress={() => step(-1)}
        />
        <Text numeric style={styles.value}>
          {valueText}
        </Text>
        <StepButton
          label={incrementLabel}
          icon={Plus}
          disabled={!canIncrement}
          onPress={() => step(1)}
        />
      </View>
    </View>
  );
}

function StepButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly icon: IconComponent;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Icon
        icon={icon}
        size={20}
        color={disabled ? color.stepperDisabledInk : color.navy}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // `.bk-stp`: 72 tall at least, 16 across, 12 down; the label column
  // shrinks and wraps, the controls never do.
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    minHeight: 72,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  disabled: { opacity: 0.5 },
  text: { flex: 1, minWidth: 0 },
  label: { ...typeScale.bodyStrong, color: color.navy },
  hint: { ...typeScale.bodySmall, color: color.ink2 },
  warning: {
    color: color.warningInk,
    fontVariationSettings: brandFontVariation(500),
    fontWeight: "500",
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: space.xs,
  },
  // `.bk-sb`: a 48 disc with the outline drawn inside.
  button: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.outline,
    borderRadius: touchTarget / 2,
    borderWidth: 1,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { backgroundColor: color.pressed },
  buttonDisabled: {
    backgroundColor: color.stepperDisabledFill,
    borderColor: color.disabled,
  },
  value: {
    ...typeScale.title,
    color: color.navy,
    fontVariationSettings: brandFontVariation(700),
    fontWeight: "700",
    lineHeight: 24,
    minWidth: 36,
    textAlign: "center",
  },
});
