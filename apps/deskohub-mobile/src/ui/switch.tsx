import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { listRowLayout } from "./list-row-layout";
import { LoadingIndicator } from "./loading-indicator";
import { Text } from "./text";
import { ToggleRow } from "./toggle-row";
import { color, radius, space } from "./tokens";

/**
 * The switch's track and thumb, drawn only. Off: a grey track with a small
 * thumb at the start; on: an orange track with a white thumb at the end
 * holding a check. While `busy` the thumb grows and the loading indicator
 * takes the check's place. With an `icon` the thumb is large in both states
 * and holds the icon instead of the check, white off and orange on.
 */
export function SwitchTrack({
  value,
  busy = false,
  disabled = false,
  icon,
}: {
  readonly value: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** A glyph the thumb always shows, such as the overnight stay's moon. */
  readonly icon?: IconComponent;
}) {
  const look = switchLook({ value, busy, disabled, icon: icon !== undefined });
  const glyph = icon ?? (value ? Check : undefined);
  return (
    <View aria-hidden style={[styles.track, styles[look.track]]}>
      <View style={[styles.thumb, styles[look.thumb]]}>
        {busy ? (
          <LoadingIndicator size="inline" tone={{ color: look.glyph }} />
        ) : (
          glyph && (
            <Icon
              icon={glyph}
              size={icon === undefined ? 16 : 14}
              color={look.glyph}
            />
          )
        )}
      </View>
    </View>
  );
}

/** Which track, thumb and glyph colour a switch draws in each state. */
export const switchLook = ({
  value,
  busy,
  disabled,
  icon = false,
}: {
  readonly value: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  /** Whether the thumb holds an icon, which keeps it large when off. */
  readonly icon?: boolean;
}) => {
  if (disabled) {
    return value
      ? ({
          track: "disabledOnTrack",
          thumb: "disabledThumbOn",
          glyph: color.disabledInk,
        } as const)
      : ({
          track: "disabledOffTrack",
          thumb: icon ? "disabledLargeThumbOff" : "disabledThumbOff",
          glyph: color.disabledInk,
        } as const);
  }
  return value
    ? ({
        track: "onTrack",
        thumb: "thumbOn",
        glyph: color.action,
      } as const)
    : ({
        track: "offTrack",
        thumb: busy || icon ? "largeThumbOff" : "thumbOff",
        glyph: color.white,
      } as const);
};

/**
 * A standalone switch, 52 × 32 with a 48 dp target. In a list, use
 * `SwitchRow`, whose whole row toggles. While `busy` it ignores presses.
 * A `label` draws before the track, grey off and orange on, and presses
 * with it.
 */
export function Switch({
  value,
  onValueChange,
  busy = false,
  disabled = false,
  accessibilityLabel,
  label,
  icon,
}: {
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly accessibilityLabel: string;
  /** Visible text before the track, such as a section heading's "Overnight". */
  readonly label?: string;
  /** A glyph the thumb always shows; see `SwitchTrack`. */
  readonly icon?: IconComponent;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      role="switch"
      aria-label={accessibilityLabel}
      aria-checked={value}
      aria-disabled={disabled}
      aria-busy={busy}
      disabled={disabled}
      onPress={busy ? undefined : () => onValueChange(!value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // The track is 32 tall; its target stays 48.
      hitSlop={{ top: space.sm, bottom: space.sm }}
      style={[
        styles.standalone,
        label !== undefined && styles.labelled,
        focused && styles.focused,
      ]}
    >
      {label !== undefined && (
        <Text
          variant="bodySmall"
          tone={value && !disabled ? "action" : "muted"}
          style={styles.label}
        >
          {label}
        </Text>
      )}
      <SwitchTrack
        value={value}
        busy={busy}
        disabled={disabled}
        {...(icon === undefined ? {} : { icon })}
      />
    </Pressable>
  );
}

/**
 * A list row whose whole area toggles the switch at its end, such as a
 * notification preference. While `busy` (saving the change) the switch
 * shows the loading indicator and the row ignores presses.
 */
export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  busy = false,
  disabled = false,
  icon,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** An icon tile at the start, as on `ListRow`. */
  readonly icon?: IconComponent;
}) {
  return (
    <ToggleRow
      role="switch"
      label={label}
      labelWeight="strong"
      description={description}
      checked={value}
      onToggle={onValueChange}
      busy={busy}
      disabled={disabled}
      align="center"
      leading={
        icon && (
          <View style={listRowLayout.iconTile}>
            <Icon
              icon={icon}
              size={20}
              color={disabled ? color.disabledInk : color.navy}
            />
          </View>
        )
      }
      trailing={<SwitchTrack value={value} busy={busy} disabled={disabled} />}
    />
  );
}

const trackWidth = 52;
const trackHeight = 32;
const ring = 2;
const smallThumb = 16;
const largeThumb = 24;
// Thumb offsets inside the 2 dp ring: the small thumb sits 8 from the
// track's edge, the large one 4.
const smallInset = (trackHeight - smallThumb) / 2 - ring;
const largeInset = (trackHeight - largeThumb) / 2 - ring;
const largeEnd =
  trackWidth - largeThumb - (trackHeight - largeThumb) / 2 - ring;

const thumb = (size: number, left: number, backgroundColor: string) => ({
  backgroundColor,
  height: size,
  left,
  top: (trackHeight - size) / 2 - ring,
  width: size,
});

const styles = StyleSheet.create({
  standalone: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space.sm,
  },
  // Beside a heading the label wraps rather than push the track out.
  labelled: { flexShrink: 1 },
  label: { flexShrink: 1 },
  focused: {
    outlineColor: color.action,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
  track: {
    borderRadius: radius.pill,
    flexShrink: 0,
    borderWidth: ring,
    height: trackHeight,
    width: trackWidth,
  },
  offTrack: { backgroundColor: color.disabled, borderColor: color.field },
  onTrack: { backgroundColor: color.action, borderColor: color.action },
  disabledOffTrack: {
    backgroundColor: color.disabledField,
    borderColor: color.disabled,
  },
  disabledOnTrack: {
    backgroundColor: color.disabled,
    borderColor: color.disabled,
  },
  thumb: {
    alignItems: "center",
    borderRadius: radius.pill,
    justifyContent: "center",
    position: "absolute",
  },
  thumbOff: thumb(smallThumb, smallInset, color.field),
  thumbOn: thumb(largeThumb, largeEnd, color.white),
  largeThumbOff: thumb(largeThumb, largeInset, color.field),
  disabledThumbOff: thumb(smallThumb, smallInset, color.outline),
  disabledLargeThumbOff: thumb(largeThumb, largeInset, color.outline),
  disabledThumbOn: thumb(largeThumb, largeEnd, color.white),
});
