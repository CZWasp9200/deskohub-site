import { type ComponentRef, useId, useRef } from "react";
import { Pressable, View } from "react-native";
import { choiceIndexForKey, tabStopIndex } from "./choice-group-keys";
import {
  RadioCardContent,
  radioCardStyle,
  radioGroupStyle,
} from "./radio-card";
import { Text } from "./text";

export type Choice<T extends string> = {
  readonly value: T;
  readonly label: string;
};

/**
 * A labelled set of options of which exactly one is chosen, such as a
 * billing type. It reads as a radio group, each option as a radio with its
 * checked state; the visible label names the group. With a keyboard the
 * group is one tab stop, arrows move the choice and Space chooses.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<Choice<T>>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  const labelId = useId();
  const optionRefs = useRef<Array<ComponentRef<typeof Pressable> | null>>([]);
  const tabStop = tabStopIndex(
    options.map((option) => option.value),
    value
  );
  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined && option.value !== value) onChange(option.value);
  };
  return (
    <View role="radiogroup" aria-labelledby={labelId} style={radioGroupStyle}>
      <Text id={labelId} variant="label">
        {label}
      </Text>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <Pressable
            key={option.value}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled}
            disabled={disabled}
            tabIndex={!disabled && index === tabStop ? 0 : -1}
            onPress={() => choose(index)}
            onKeyDown={(event) => {
              if (disabled) return;
              const next = choiceIndexForKey(
                event.nativeEvent.key,
                index,
                options.length
              );
              if (next === undefined) return;
              // Arrows would scroll the page and Space would page down.
              event.preventDefault();
              optionRefs.current[next]?.focus();
              choose(next);
            }}
            style={({ pressed }) =>
              radioCardStyle({ checked, disabled, pressed })
            }
          >
            <RadioCardContent
              label={option.label}
              checked={checked}
              disabled={disabled}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
