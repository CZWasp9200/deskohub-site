import { Pressable, View } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import {
  RadioCardContent,
  radioCardStyle,
  radioGroupStyle,
} from "./radio-card";

export interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** The language the label is in when it isn't the app's, such as a language's own name. */
  readonly labelLocale?: AppLocale;
  /** A second line, such as a price or why the choice is unavailable. */
  readonly description?: string;
  readonly disabled?: boolean;
}

/**
 * A single-choice group: one radio card per choice, the selected one
 * outlined in orange on the action tint. The whole card is the target.
 */
export function ChoiceList<Value extends string>({
  label,
  choices,
  selected,
  onSelect,
  disabled = false,
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly choices: ReadonlyArray<Choice<Value>>;
  readonly selected: Value | undefined;
  readonly onSelect: (value: Value) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View role="radiogroup" aria-label={label} style={radioGroupStyle}>
      {choices.map((choice) => {
        const isSelected = choice.value === selected;
        const isDisabled = disabled || choice.disabled === true;
        return (
          <Pressable
            key={choice.value}
            role="radio"
            aria-checked={isSelected}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            onPress={() => onSelect(choice.value)}
            style={({ pressed }) =>
              radioCardStyle({
                checked: isSelected,
                disabled: isDisabled,
                pressed,
              })
            }
          >
            <RadioCardContent
              label={choice.label}
              labelLocale={choice.labelLocale}
              description={choice.description}
              checked={isSelected}
              disabled={isDisabled}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
