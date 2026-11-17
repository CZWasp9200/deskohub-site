import Search from "lucide-react-native/icons/search";
import { useState } from "react";
import { View } from "react-native";
import {
  fieldFrameState,
  fieldFrameStyles,
  fieldIconColor,
  fieldInkColor,
  fieldInputStyle,
} from "./field";
import { Icon } from "./icon";
import { TextInput } from "./text";
import { color } from "./tokens";

/**
 * A search box that filters a list as the customer types: a field frame
 * with a magnifier and the placeholder saying what it searches, which is
 * also its name for assistive tech (it has no label above). It rings
 * orange on focus, like `TextField`.
 */
export function SearchField({
  placeholder,
  value,
  onChangeText,
}: {
  /** What it searches, such as "Search countries". */
  readonly placeholder: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const state = fieldFrameState({ focused });
  return (
    <View style={[fieldFrameStyles.base, fieldFrameStyles[state]]}>
      <Icon icon={Search} size={20} color={fieldIconColor(state)} />
      <TextInput
        role="searchbox"
        aria-label={placeholder}
        placeholder={placeholder}
        placeholderTextColor={color.ink3}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        style={[fieldInputStyle, { color: fieldInkColor(state) }]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}
