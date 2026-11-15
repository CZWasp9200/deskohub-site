import { Children, type ReactNode, type Ref, useId, useState } from "react";
import {
  Pressable,
  StyleSheet,
  type TextInputInstance,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../theme";
import { fieldErrorPresentation } from "./field-error-presentation";
import { Icon, type IconComponent } from "./icon";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { LoadingIndicator } from "./loading-indicator";
import { Text, TextInput } from "./text";
import { textFieldSubmit } from "./text-field-submit";
import { color, radius, shadow, space, touchTarget } from "./tokens";

/**
 * A centred screen with a heading. Its content keeps to a readable width;
 * `align="center"` also centres each item, as on the home screen.
 */
export function Screen({
  title,
  align = "start",
  children,
}: {
  readonly title: string;
  readonly align?: "start" | "center";
  readonly children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View
        style={[styles.content, align === "center" && styles.centeredContent]}
      >
        <Text role="heading" style={styles.title}>
          {title}
        </Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function BodyText({ children }: { readonly children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

/** What a button does, by look: see `Button`. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "text"
  | "quiet"
  | "dangerText"
  | "inverse";

const buttonLabelColor = {
  primary: color.white,
  secondary: color.navy,
  danger: color.white,
  text: color.action,
  quiet: color.navy,
  dangerText: color.dangerInk,
  inverse: color.navy,
} as const satisfies Record<ButtonVariant, string>;

/**
 * A pill button, 48 tall (40 drawn with a 48 target when `small`).
 *
 * - `primary`: burned orange, one per screen; `secondary`: outlined white;
 *   `danger`: crimson, for the destructive step itself; `text`: an orange
 *   text button (the boards' tinted button); `quiet`: a navy text button;
 *   `dangerText`: a crimson text button; `inverse`: white on navy.
 * - `busy`: the shared loading indicator replaces the icon and the label
 *   stays, the button keeps its size and ignores presses.
 * - `disabled`: neutral grey, never a dimmed brand colour. `disabledReason`
 *   says why, centred above the button and as its accessibility hint.
 * - The label wraps instead of truncating at large font sizes; `width`
 *   `full` stretches across its container, `content` hugs the label.
 */
export function Button({
  label,
  onPress,
  disabled = false,
  disabledReason,
  busy = false,
  variant = "primary",
  icon,
  size = "regular",
  width = "full",
  accessibilityLabel,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Why the button is disabled, shown above it while it is. */
  readonly disabledReason?: string;
  /** The action is running: shows the loading indicator in the button. */
  readonly busy?: boolean;
  readonly variant?: ButtonVariant;
  /** A Lucide icon before the label. */
  readonly icon?: IconComponent;
  readonly size?: "regular" | "small";
  readonly width?: "full" | "content";
  /** The accessible name when the visible label alone is ambiguous, such as "Delete" in a list. */
  readonly accessibilityLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const reasonId = useId();
  const reason = disabled && !busy ? disabledReason : undefined;
  const labelColor = disabled ? color.disabledInk : buttonLabelColor[variant];
  const filled = variant === "primary" || variant === "danger";
  const textOnly =
    variant === "text" || variant === "quiet" || variant === "dangerText";
  const pressable = (
    <Pressable
      role="button"
      aria-label={accessibilityLabel}
      aria-disabled={disabled}
      aria-busy={busy}
      // Native platforms read the hint; the web reads `aria-describedby`.
      accessibilityHint={reason}
      aria-describedby={reason && reasonId}
      disabled={disabled}
      onPress={busy ? undefined : onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // A small button is drawn 40 tall; its target stays 48.
      hitSlop={size === "small" ? { top: 4, bottom: 4 } : undefined}
      style={({ pressed }) => [
        buttonStyles.base,
        size === "small" && buttonStyles.small,
        textOnly && buttonStyles.textOnly,
        width === "full" ? buttonStyles.fullWidth : buttonStyles.contentWidth,
        buttonStyles[variant],
        pressed && !disabled && !busy && buttonPressedStyles[variant],
        disabled && !textOnly && buttonDisabledStyle(variant),
        focused && buttonStyles.focused,
      ]}
    >
      {busy ? (
        <LoadingIndicator
          size="inline"
          tone={filled && !disabled ? "white" : { color: labelColor }}
        />
      ) : (
        icon && <Icon icon={icon} size={20} color={labelColor} />
      )}
      <Text
        variant={size === "small" ? "buttonSmall" : "button"}
        style={[buttonStyles.label, { color: labelColor }]}
      >
        {label}
      </Text>
    </Pressable>
  );
  if (disabledReason === undefined) return pressable;
  return (
    <View
      style={[
        buttonStyles.withReason,
        width === "full" ? buttonStyles.fullWidth : buttonStyles.contentWidth,
      ]}
    >
      <Text
        id={reasonId}
        variant="hint"
        style={[buttonStyles.reason, !reason && buttonStyles.reasonHidden]}
      >
        {reason ?? ""}
      </Text>
      {pressable}
    </View>
  );
}

/**
 * Buttons side by side, sharing the width equally (the boards' half-width
 * pair). When the labels no longer fit, as at large font sizes, the buttons
 * stack instead.
 */
export function ButtonRow({ children }: { readonly children: ReactNode }) {
  return (
    <View style={buttonStyles.row}>
      {Children.map(children, (child) =>
        child ? <View style={buttonStyles.rowItem}>{child}</View> : null
      )}
    </View>
  );
}

const buttonStyles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: space.xxl,
    paddingVertical: 14,
  },
  small: { minHeight: 40, paddingHorizontal: space.lg, paddingVertical: 10 },
  textOnly: { paddingHorizontal: space.lg },
  fullWidth: { alignSelf: "stretch" },
  contentWidth: { alignSelf: "flex-start" },
  label: { flexShrink: 1, textAlign: "center" },
  primary: { backgroundColor: color.action, ...shadow.primary },
  secondary: {
    backgroundColor: color.surface,
    borderColor: color.outline,
    borderWidth: 1,
  },
  danger: { backgroundColor: color.danger, ...shadow.danger },
  text: { backgroundColor: "transparent" },
  quiet: { backgroundColor: "transparent" },
  dangerText: { backgroundColor: "transparent" },
  inverse: { backgroundColor: color.surface },
  disabled: { backgroundColor: color.disabled, boxShadow: undefined },
  secondaryDisabled: { borderColor: color.disabled },
  focused: {
    outlineColor: color.action,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
  withReason: { gap: space.sm },
  reason: { textAlign: "center" },
  reasonHidden: { display: "none" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  rowItem: { flexBasis: 136, flexGrow: 1 },
});

const buttonDisabledStyle = (variant: ButtonVariant) =>
  variant === "secondary"
    ? buttonStyles.secondaryDisabled
    : buttonStyles.disabled;

const textPressed = { backgroundColor: "rgba(0, 2, 79, 0.06)" } as const;

const buttonPressedStyles = StyleSheet.create({
  primary: {
    backgroundColor: color.actionPressed,
    boxShadow: undefined,
    transform: [{ translateY: 1 }],
  },
  secondary: { backgroundColor: color.sunken },
  danger: {
    backgroundColor: color.dangerInk,
    boxShadow: undefined,
    transform: [{ translateY: 1 }],
  },
  text: textPressed,
  quiet: textPressed,
  dangerText: textPressed,
  inverse: { backgroundColor: color.sunken },
}) satisfies Record<ButtonVariant, object>;

/**
 * A labelled text input. With an `error` the input turns invalid and shows
 * the error beneath it, in a live region that stays mounted so assistive
 * tech announces each new error, and in the input's description, so it is
 * read again when the input gains focus.
 */
export function TextField({
  label,
  error,
  autoCapitalize = "none",
  onSubmitEditing,
  ...input
}: {
  readonly label: string;
  readonly error?: string;
  /** Lets a form focus the field, such as its first invalid one. */
  readonly ref?: Ref<TextInputInstance>;
} & Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "onSubmitEditing"
  | "onBlur"
  | "autoCapitalize"
  | "autoComplete"
  | "keyboardType"
  | "inputMode"
  | "textContentType"
  | "returnKeyType"
  | "maxLength"
  | "autoFocus"
  | "editable"
>) {
  const errorId = useId();
  const { invalid, description, role, live, idleLayout } =
    fieldErrorPresentation(error);
  useLiveRegionAnnouncement(description, live);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        aria-label={label}
        // Native platforms read the hint; the web reads `aria-describedby`
        // and `aria-invalid`, which react-native-web maps and RN ignores.
        accessibilityHint={description}
        aria-describedby={invalid ? errorId : undefined}
        aria-invalid={invalid}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[styles.input, invalid && styles.invalidInput]}
        placeholderTextColor={theme.colors.textMuted}
        {...input}
        onSubmitEditing={textFieldSubmit(input.editable, onSubmitEditing)}
      />
      <Text
        id={errorId}
        role={role}
        aria-live={live}
        // Text doesn't map `aria-live` to Android's live region; View does.
        accessibilityLiveRegion={live}
        style={idleLayout ?? styles.fieldError}
      >
        {description ?? ""}
      </Text>
    </View>
  );
}

/**
 * Live regions stay mounted so assistive tech announces each change; only
 * their text changes. `status` is polite progress, `alert` an error. iOS,
 * which ignores `aria-live`, has each change announced directly.
 */
export function LiveMessage({
  role,
  message,
}: {
  readonly role: "status" | "alert";
  readonly message: string | undefined;
}) {
  useLiveRegionAnnouncement(message, role === "alert" ? "assertive" : "polite");
  return (
    <Text
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      // Text doesn't map `aria-live` to Android's live region; View does.
      accessibilityLiveRegion={role === "alert" ? "assertive" : "polite"}
      style={role === "alert" ? styles.alert : styles.status}
    >
      {message ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  content: {
    alignSelf: "center",
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: "center",
    maxWidth: 480,
    padding: theme.spacing.lg,
    width: "100%",
  },
  centeredContent: { alignItems: "center" },
  title: { color: theme.colors.text, ...theme.type.title },
  body: { color: theme.colors.textMuted, ...theme.type.body },
  field: { gap: theme.spacing.sm },
  fieldLabel: { color: theme.colors.text, ...theme.type.body },
  input: {
    borderColor: theme.colors.textMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    ...theme.type.body,
  },
  invalidInput: { borderColor: theme.colors.danger },
  fieldError: { color: theme.colors.danger, ...theme.type.caption },
  status: { color: theme.colors.textMuted, ...theme.type.body },
  alert: { color: theme.colors.accent, ...theme.type.body },
});
