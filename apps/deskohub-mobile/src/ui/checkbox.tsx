import Check from "lucide-react-native/icons/check";
import { StyleSheet, View } from "react-native";
import { Icon } from "./icon";
import { ToggleRow } from "./toggle-row";
import { color, radius } from "./tokens";

/** A checked box's fill: orange, or crimson to confirm a destructive step. */
export type CheckboxTone = "default" | "danger";

const checkedFill = {
  default: color.action,
  danger: color.danger,
} as const satisfies Record<CheckboxTone, string>;

/**
 * The 22 dp checkbox, drawn only: the row or card around it is the control
 * (see `CheckboxRow`). Checked, it fills with a white check.
 */
export function Checkbox({
  checked,
  tone = "default",
  disabled = false,
}: {
  readonly checked: boolean;
  readonly tone?: CheckboxTone;
  readonly disabled?: boolean;
}) {
  const fill = disabled ? color.disabled : checkedFill[tone];
  return (
    <View
      aria-hidden
      style={[
        styles.box,
        checked
          ? { backgroundColor: fill, borderColor: fill }
          : disabled && styles.disabled,
      ]}
    >
      {checked && (
        <Icon
          icon={Check}
          size={16}
          color={disabled ? color.disabledInk : color.white}
        />
      )}
    </View>
  );
}

/**
 * A row whose whole area toggles its checkbox, for a consent or a
 * confirmation. `danger` checks in crimson, for confirming a destructive
 * step such as deleting the account.
 */
export function CheckboxRow({
  label,
  description,
  checked,
  onChange,
  tone = "default",
  disabled = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly tone?: CheckboxTone;
  readonly disabled?: boolean;
}) {
  return (
    <ToggleRow
      role="checkbox"
      label={label}
      labelWeight="regular"
      description={description}
      checked={checked}
      onToggle={onChange}
      disabled={disabled}
      align="top"
      leading={<Checkbox checked={checked} tone={tone} disabled={disabled} />}
    />
  );
}

const boxSize = 22;

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.field,
    borderRadius: radius.checkbox,
    borderWidth: 2,
    height: boxSize,
    justifyContent: "center",
    // Centres the box on the first line of a 24 dp label.
    marginTop: 1,
    width: boxSize,
  },
  disabled: {
    backgroundColor: color.disabledField,
    borderColor: color.disabled,
  },
});
