import Lock from "lucide-react-native/icons/lock";
import {
  Children,
  type ComponentRef,
  createContext,
  type ReactNode,
  type Ref,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  type TextInputInstance,
  type TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FieldLabel,
  FieldMessages,
  fieldColumnStyle,
  fieldDescription,
  fieldFrameState,
  fieldFrameStyles,
  fieldIconColor,
  fieldInkColor,
  fieldInputStyle,
} from "./field";
import { FocusedFieldContext } from "./focused-field-scroll";
import { Icon, type IconComponent } from "./icon";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { LoadingIndicator } from "./loading-indicator";
import { idleLiveRegionLayout } from "./notice-presentation";
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
        <Text role="heading" variant="titleLarge">
          {title}
        </Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function BodyText({ children }: { readonly children: ReactNode }) {
  return (
    <Text variant="body" tone="muted">
      {children}
    </Text>
  );
}

/** What a button does, by look: see `Button`. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  /** An affirmative choice beside a destructive one, such as "Don't withdraw". */
  | "positive"
  | "text"
  | "quiet"
  | "dangerText"
  | "inverse";

const buttonLabelColor = {
  primary: color.white,
  secondary: color.navy,
  danger: color.white,
  positive: color.white,
  text: color.action,
  quiet: color.navy,
  dangerText: color.dangerInk,
  inverse: color.navy,
} as const satisfies Record<ButtonVariant, string>;

/**
 * Whether a focus draws the button's focus ring. On the web only a focus the
 * browser marks `:focus-visible` (the keyboard's) does, so a pointer press
 * doesn't ring the button; native focus comes from a keyboard or assistive
 * technology, so it always does.
 */
export const showsFocusRing = (os: string, target: unknown): boolean => {
  if (os !== "web") return true;
  const element = target as { matches?: (selector: string) => boolean } | null;
  return (
    typeof element?.matches !== "function" || element.matches(":focus-visible")
  );
};

/**
 * A pill button, 48 tall (40 drawn with a 48 target when `small`).
 *
 * - `primary`: burned orange, one per screen; `secondary`: outlined white;
 *   `danger`: crimson, for the destructive step itself; `text`: an orange
 *   text button (the boards' tinted button); `quiet`: a navy text button;
 *   `dangerText`: a crimson text button; `inverse`: white on navy.
 * - `busy`: the shared loading indicator takes the icon's place (without an
 *   icon, its slot comes out of the side padding); the label stays, the
 *   button keeps its size and ignores presses.
 * - `disabled`: neutral grey, never a dimmed brand colour. `disabledReason`
 *   says why, centred above the button (or below it with
 *   `reasonPlacement="below"`, as under the booking bar's Continue) and as
 *   its accessibility hint.
 * - The label wraps instead of truncating at large font sizes; `width`
 *   `full` stretches across its container, `content` hugs the label.
 */
export function Button({
  label,
  onPress,
  disabled = false,
  disabledReason,
  reasonPlacement = "above",
  busy = false,
  variant = "primary",
  icon,
  iconPlacement = "start",
  size = "regular",
  width = "full",
  accessibilityLabel,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Why the button is disabled, shown beside it while it is. */
  readonly disabledReason?: string;
  /** Where the disabled reason sits: above the button (default) or below it. */
  readonly reasonPlacement?: "above" | "below";
  /** The action is running: shows the loading indicator in the button. */
  readonly busy?: boolean;
  readonly variant?: ButtonVariant;
  /** A Lucide icon before the label. */
  readonly icon?: IconComponent;
  /** `end` puts the icon after the label, as for a page opening outside the app. */
  readonly iconPlacement?: "start" | "end";
  readonly size?: "regular" | "small";
  readonly width?: "full" | "content";
  /** The accessible name when the visible label alone is ambiguous, such as "Delete" in a list. */
  readonly accessibilityLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const half = useContext(ButtonRowContext);
  const reasonId = useId();
  const reason = disabled && !busy ? disabledReason : undefined;
  const labelColor = disabled ? color.disabledInk : buttonLabelColor[variant];
  const filled =
    variant === "primary" || variant === "danger" || variant === "positive";
  const textOnly =
    variant === "text" || variant === "quiet" || variant === "dangerText";
  const busyIndicator = (
    <LoadingIndicator
      size="inline"
      tone={filled && !disabled ? "white" : { color: labelColor }}
    />
  );
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
      onFocus={(event) => setFocused(showsFocusRing(Platform.OS, event.target))}
      onBlur={() => setFocused(false)}
      // A small button is drawn 40 tall; its target stays 48.
      hitSlop={size === "small" ? { top: 4, bottom: 4 } : undefined}
      style={({ pressed }) => [
        buttonStyles.base,
        size === "small" && buttonStyles.small,
        textOnly && buttonStyles.textOnly,
        half && buttonStyles.half,
        width === "full" ? buttonStyles.fullWidth : buttonStyles.contentWidth,
        buttonStyles[variant],
        // The raised lighting of a filled button goes while it is pressed or
        // disabled; a later style can't unset a shadow, so it is added only here.
        !(pressed || disabled) && buttonShadow[variant],
        pressed && !disabled && !busy && buttonPressedStyles[variant],
        disabled && !textOnly && buttonDisabledStyle(variant),
        focused && buttonStyles.focused,
        // Without an icon, the die's slot and gap come out of the side
        // padding, so going busy changes neither the width nor the label's.
        busy &&
          !icon && {
            paddingHorizontal: Math.max(
              0,
              buttonSidePadding({ size, textOnly, half }) - busySlotWidth / 2
            ),
          },
      ]}
    >
      {(busy || (icon && iconPlacement === "start")) && (
        // The die takes the icon's 20 dp slot, so the button keeps its size.
        <View style={buttonStyles.iconSlot}>
          {busy
            ? busyIndicator
            : icon && <Icon icon={icon} size={20} color={labelColor} />}
        </View>
      )}
      <Text
        variant={size === "small" ? "buttonSmall" : "button"}
        style={[buttonStyles.label, { color: labelColor }]}
      >
        {label}
      </Text>
      {!busy && icon && iconPlacement === "end" && (
        <View style={buttonStyles.iconSlot}>
          <Icon icon={icon} size={20} color={labelColor} />
        </View>
      )}
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
      {reasonPlacement === "below" && pressable}
      <Text
        id={reasonId}
        variant="hint"
        style={[buttonStyles.reason, !reason && buttonStyles.reasonHidden]}
      >
        {reason ?? ""}
      </Text>
      {reasonPlacement === "above" && pressable}
    </View>
  );
}

/** The side padding a button's label keeps from its edges. */
const buttonSidePadding = ({
  size,
  textOnly,
  half,
}: {
  readonly size: "regular" | "small";
  readonly textOnly: boolean;
  readonly half: boolean;
}) => {
  if (half) return space.md;
  return size === "small" || textOnly ? space.lg : space.xxl;
};

/** Whether a button is one of a `ButtonRow`'s half-width pair. */
const ButtonRowContext = createContext(false);

/**
 * Buttons side by side, sharing the width equally (the boards' half-width
 * pair, with 12 dp side padding and one height). When the labels no longer
 * fit, as at large font sizes, the buttons stack instead.
 */
export function ButtonRow({ children }: { readonly children: ReactNode }) {
  // A button's label grows with the system font size, so the width at which
  // two buttons still share a row grows with it too.
  const { fontScale } = useWindowDimensions();
  const item = { flexBasis: buttonRowItemWidth * fontScale, flexGrow: 1 };
  return (
    <ButtonRowContext value={true}>
      <View style={buttonStyles.row}>
        {Children.map(children, (child) =>
          child ? <View style={item}>{child}</View> : null
        )}
      </View>
    </ButtonRowContext>
  );
}

/** The narrowest a button in a row gets at the default font size. */
const buttonRowItemWidth = 136;

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
  // A pair shares one height, however its labels wrap.
  half: { flexGrow: 1, paddingHorizontal: space.md },
  fullWidth: { alignSelf: "stretch" },
  contentWidth: { alignSelf: "flex-start" },
  label: { flexShrink: 1, textAlign: "center" },
  iconSlot: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  primary: { backgroundColor: color.action },
  secondary: {
    backgroundColor: color.surface,
    borderColor: color.outline,
    borderWidth: 1,
  },
  danger: { backgroundColor: color.danger },
  positive: { backgroundColor: color.positiveInk },
  text: { backgroundColor: "transparent" },
  quiet: { backgroundColor: "transparent" },
  dangerText: { backgroundColor: "transparent" },
  inverse: { backgroundColor: color.surface },
  disabled: { backgroundColor: color.disabled },
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
});

/** The die's slot plus the gap before the label. */
const busySlotWidth = 20 + space.sm;

const buttonShadow: Partial<Record<ButtonVariant, object>> = {
  primary: shadow.primary,
  danger: shadow.danger,
};

const buttonDisabledStyle = (variant: ButtonVariant) =>
  variant === "secondary"
    ? buttonStyles.secondaryDisabled
    : buttonStyles.disabled;

const textPressed = { backgroundColor: "rgba(0, 2, 79, 0.06)" } as const;

const buttonPressedStyles = StyleSheet.create({
  primary: {
    backgroundColor: color.actionPressed,
    transform: [{ translateY: 1 }],
  },
  secondary: { backgroundColor: color.sunken },
  danger: {
    backgroundColor: color.dangerInk,
    transform: [{ translateY: 1 }],
  },
  positive: {
    backgroundColor: color.positiveInk,
    opacity: 0.9,
    transform: [{ translateY: 1 }],
  },
  text: textPressed,
  quiet: textPressed,
  dangerText: textPressed,
  inverse: { backgroundColor: color.sunken },
}) satisfies Record<ButtonVariant, object>;

/**
 * A labelled text input: the label above, a 52 dp outlined frame that rings
 * orange on focus, and a hint below. With an `error` the frame rings crimson
 * and the error, with its icon, replaces the hint. The error shows in a live
 * region that stays mounted so assistive tech announces each new error, and
 * in the input's description, so it is read again when the input gains
 * focus. `readOnly` shows a sunken frame with a lock; `disabled` greys it.
 */
export function TextField({
  label,
  optional,
  hint,
  error,
  readOnly = false,
  disabled = false,
  leadingIcon,
  trailingIcon,
  accessory,
  autoCapitalize = "none",
  editable,
  onBlur,
  onSubmitEditing,
  ...input
}: {
  readonly label: string;
  /** The marker after the label of a field that may stay empty. */
  readonly optional?: string;
  /** Help under the field, such as the format it expects. */
  readonly hint?: string;
  readonly error?: string;
  /** Shows a value the customer can't change here, such as the login email. */
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly leadingIcon?: IconComponent;
  /** An icon at the end of the frame; a read-only field shows a lock. */
  readonly trailingIcon?: IconComponent;
  /**
   * A control beside the field, such as a code's Apply button. The label
   * sits above both and the messages under both; the control drops under
   * the field when the row is too narrow for the two.
   */
  readonly accessory?: ReactNode;
  /** Lets a form focus the field, such as its first invalid one. */
  readonly ref?: Ref<TextInputInstance>;
} & Pick<
  TextInputProps,
  | "value"
  | "placeholder"
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
  const [focused, setFocused] = useState(false);
  // The scroll view keeps the whole field (label to messages) in sight.
  const focusTracker = useContext(FocusedFieldContext);
  const column = useRef<ComponentRef<typeof View>>(null);
  const hintId = useId();
  const errorId = useId();
  const messages = { hint, hintId, error, errorId };
  const description = fieldDescription(messages);
  const state = fieldFrameState({
    disabled,
    readOnly,
    invalid: description.invalid,
    focused,
  });
  const typeable = editable !== false && !readOnly && !disabled;
  const trailing = trailingIcon ?? (readOnly ? Lock : undefined);
  const iconColor = fieldIconColor(state);
  return (
    <View ref={column} style={fieldColumnStyle}>
      <FieldLabel label={label} optional={optional} />
      {fieldRow(
        <View style={[fieldFrameStyles.base, fieldFrameStyles[state]]}>
          {leadingIcon && (
            <Icon icon={leadingIcon} size={20} color={iconColor} />
          )}
          {readOnly ? (
            // A locked value can't be edited, so it shows whole: it wraps
            // instead of scrolling out of sight at large font sizes.
            <Text
              selectable
              style={[
                fieldInputStyle,
                styles.readOnlyValue,
                { color: fieldInkColor(state) },
              ]}
            >
              {input.value}
            </Text>
          ) : (
            <TextInput
              aria-label={
                optional === undefined ? label : `${label} ${optional}`
              }
              aria-disabled={disabled}
              // Native platforms read the hint; the web reads `aria-describedby`
              // and `aria-invalid`, which react-native-web maps and RN ignores.
              accessibilityHint={description.hint}
              aria-describedby={description.describedBy}
              aria-invalid={description.invalid}
              autoCapitalize={autoCapitalize}
              autoCorrect={false}
              style={[fieldInputStyle, { color: fieldInkColor(state) }]}
              placeholderTextColor={color.ink3}
              {...input}
              editable={typeable}
              onFocus={() => {
                setFocused(true);
                if (column.current) focusTracker.focused(column.current);
              }}
              onBlur={(event) => {
                setFocused(false);
                if (column.current) focusTracker.blurred(column.current);
                onBlur?.(event);
              }}
              onSubmitEditing={textFieldSubmit(typeable, onSubmitEditing)}
            />
          )}
          {trailing && (
            <Icon icon={trailing} size={readOnly ? 18 : 20} color={iconColor} />
          )}
        </View>,
        accessory
      )}
      <FieldMessages {...messages} />
    </View>
  );
}

/**
 * Live regions stay mounted so assistive tech announces each change; only
 * their text changes, and while idle they take no room. `status` is polite
 * progress, `alert` an error. iOS, which ignores `aria-live`, has each
 * change announced directly.
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
      variant="body"
      tone={role === "alert" ? "danger" : "muted"}
      // Idle, it takes no room, so it leaves no gap in a dialog's actions.
      style={message ? undefined : idleLiveRegionLayout}
    >
      {message ?? ""}
    </Text>
  );
}

/** The field's frame alone, or beside its `accessory`. */
const fieldRow = (frame: ReactNode, accessory: ReactNode) =>
  accessory === undefined ? (
    frame
  ) : (
    <View style={styles.accessoryRow}>
      <View style={styles.accessoryField}>{frame}</View>
      {accessory}
    </View>
  );

const styles = StyleSheet.create({
  accessoryRow: {
    alignItems: "center",
    columnGap: space.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: space.sm,
  },
  accessoryField: { flexBasis: 160, flexGrow: 1, minWidth: 0 },
  screen: { backgroundColor: color.paper, flex: 1 },
  content: {
    alignSelf: "center",
    flex: 1,
    gap: space.md,
    justifyContent: "center",
    maxWidth: 480,
    padding: space.gutter,
    width: "100%",
  },
  centeredContent: { alignItems: "center" },
  readOnlyValue: { paddingVertical: space.md },
});
