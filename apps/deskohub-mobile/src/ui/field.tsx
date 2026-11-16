import CircleAlert from "lucide-react-native/icons/circle-alert";
import { StyleSheet, View } from "react-native";
import { fieldErrorPresentation } from "./field-error-presentation";
import { Icon } from "./icon";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { Text } from "./text";
import { color, radius } from "./tokens";

/**
 * The parts every form field shares: the label above, the outlined frame,
 * and the hint or error below. `TextField` and `SelectField` compose them.
 */

/** What a field's frame shows, the first that applies winning. */
export type FieldFrameState =
  | "disabled"
  | "readOnly"
  | "invalid"
  | "focused"
  | "idle";

export const fieldFrameState = ({
  disabled = false,
  readOnly = false,
  invalid = false,
  focused = false,
}: {
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly invalid?: boolean;
  readonly focused?: boolean;
}): FieldFrameState => {
  if (disabled) return "disabled";
  if (readOnly) return "readOnly";
  if (invalid) return "invalid";
  if (focused) return "focused";
  return "idle";
};

// The ring thickens from 1 to 2 on focus and error; the padding gives back
// the difference so the content never shifts.
const framePadding = 15;
const frame = (
  backgroundColor: string,
  borderColor: string,
  borderWidth: 1 | 2
) => ({
  backgroundColor,
  borderColor,
  borderWidth,
  paddingHorizontal: framePadding - borderWidth,
});

export const fieldFrameStyles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.field,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
  },
  idle: frame(color.surface, color.field, 1),
  focused: frame(color.surface, color.action, 2),
  invalid: frame(color.surface, color.danger, 2),
  readOnly: frame(color.sunken, color.sunken, 1),
  disabled: frame(color.disabledField, color.disabled, 1),
});

/** The colour of a field's value text in each state. */
export const fieldInkColor = (state: FieldFrameState) =>
  state === "disabled" ? color.disabledInk : color.navy;

/** The colour of a field's leading and trailing icons. */
export const fieldIconColor = (state: FieldFrameState) =>
  state === "disabled" ? color.disabledInk : color.ink2;

/**
 * A field's hint, and the live region its error shows in. The error
 * replaces the hint. The region stays mounted, out of the layout while
 * idle, so assistive tech announces each new error; the field also carries
 * the message as its description (`fieldDescription`).
 */
export function FieldMessages({
  hint,
  hintId,
  error,
  errorId,
}: {
  readonly hint: string | undefined;
  readonly hintId: string;
  readonly error: string | undefined;
  readonly errorId: string;
}) {
  const { invalid, description, role, live, idleLayout } =
    fieldErrorPresentation(error);
  useLiveRegionAnnouncement(description, live);
  return (
    <>
      {!invalid && hint ? (
        <Text id={hintId} variant="hint">
          {hint}
        </Text>
      ) : null}
      <View style={idleLayout ?? styles.errorRow}>
        {invalid ? (
          <View style={styles.errorIcon}>
            <Icon icon={CircleAlert} size={16} color={color.dangerInk} />
          </View>
        ) : null}
        <Text
          id={errorId}
          role={role}
          aria-live={live}
          // Text doesn't map `aria-live` to Android's live region; View does.
          accessibilityLiveRegion={live}
          variant="hintStrong"
          tone="danger"
          style={idleLayout ?? styles.errorText}
        >
          {description ?? ""}
        </Text>
      </View>
    </>
  );
}

/**
 * What a field's control is described by: its error while it has one,
 * otherwise its hint. Native platforms read `hint`; the web reads
 * `describedBy`.
 */
export const fieldDescription = ({
  hint,
  hintId,
  error,
  errorId,
}: {
  readonly hint: string | undefined;
  readonly hintId: string;
  readonly error: string | undefined;
  readonly errorId: string;
}) => {
  const { invalid, description } = fieldErrorPresentation(error);
  if (invalid) return { invalid, hint: description, describedBy: errorId };
  if (hint) return { invalid, hint, describedBy: hintId };
  return { invalid, hint: undefined, describedBy: undefined };
};

const styles = StyleSheet.create({
  errorRow: { alignItems: "flex-start", flexDirection: "row", gap: 6 },
  errorIcon: { marginTop: 1 },
  errorText: { flexShrink: 1, minWidth: 0 },
});

/**
 * The label above a field: never floating, so a long label wraps. A `note`,
 * such as "(optional)", follows it in a lighter weight.
 */
export function FieldLabel({
  label,
  note,
}: {
  readonly label: string;
  readonly note?: string;
}) {
  return (
    <Text variant="label">
      {label}
      {note !== undefined && (
        <Text variant="bodySmall" tone="muted">{` ${note}`}</Text>
      )}
    </Text>
  );
}

/** The column a field's label, frame and messages stack in. */
export const fieldColumnStyle = { gap: 6 } as const;
