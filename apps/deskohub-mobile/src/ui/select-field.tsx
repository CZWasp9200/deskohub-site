import ChevronDown from "lucide-react-native/icons/chevron-down";
import { type ComponentRef, type Ref, useId, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  FieldLabel,
  FieldMessages,
  fieldColumnStyle,
  fieldDescription,
  fieldFrameState,
  fieldFrameStyles,
  fieldIconColor,
  fieldInkColor,
} from "./field";
import { Icon } from "./icon";
import { Text } from "./text";
import { color, space } from "./tokens";

/**
 * A field that opens a picker, such as a country sheet: drawn like a text
 * field with a chevron, showing the chosen value or a placeholder. Its hint
 * and error behave as `TextField`'s.
 */
export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  hint,
  error,
  disabled = false,
  ref,
}: {
  readonly label: string;
  /** The chosen option's label; without one the placeholder shows. */
  readonly value?: string;
  readonly placeholder?: string;
  /** Opens the picker. */
  readonly onPress: () => void;
  readonly hint?: string;
  readonly error?: string;
  readonly disabled?: boolean;
  /** The field's pressable, which a form can focus, e.g. when it is invalid. */
  readonly ref?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const [focused, setFocused] = useState(false);
  const hintId = useId();
  const errorId = useId();
  const messages = { hint, hintId, error, errorId };
  const description = fieldDescription(messages);
  const state = fieldFrameState({
    disabled,
    invalid: description.invalid,
    focused,
  });
  const chosen = value !== undefined && value !== "";
  const shown = chosen ? value : placeholder;
  return (
    <View style={fieldColumnStyle}>
      <FieldLabel label={label} />
      <Pressable
        ref={ref}
        role="button"
        aria-label={label}
        // The chosen value, read after the field's name.
        accessibilityValue={chosen ? { text: value } : undefined}
        aria-disabled={disabled}
        aria-invalid={description.invalid}
        accessibilityHint={description.hint}
        aria-describedby={description.describedBy}
        disabled={disabled}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [
          fieldFrameStyles.base,
          fieldFrameStyles[state],
          pressed && state !== "disabled" && styles.pressed,
        ]}
      >
        <Text
          variant="body"
          style={[
            styles.value,
            { color: chosen ? fieldInkColor(state) : color.ink3 },
          ]}
        >
          {shown ?? ""}
        </Text>
        <Icon icon={ChevronDown} size={20} color={fieldIconColor(state)} />
      </Pressable>
      <FieldMessages {...messages} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: color.pressed },
  value: { flex: 1, minWidth: 0, paddingVertical: space.md },
});
