import { brandFontVariation } from "@deskohub/brand-tokens";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import { type ComponentRef, useRef, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { choiceIndexForKey, tabStopIndex } from "../../ui/choice-group-keys";
import { Icon } from "../../ui/icon";
import { Text } from "../../ui/text";
import { color, radius, space, typeScale } from "../../ui/tokens";
import type { MeetingRoomStartChoice } from "../selection/meeting-room-selection";

const gap = space.sm;
const maxColumns = 4;

/**
 * How many start chips share a row: four, as the board draws them, or fewer
 * when a time at the current font size wouldn't fit its chip. `width` is the
 * grid's measured width; zero before it is measured.
 */
export const startTimeColumns = (width: number, fontScale: number) => {
  if (width <= 0) return maxColumns;
  // "00:00" in tabular figures is about 3 em wide, plus the chip's padding.
  const chipWidth =
    3 * typeScale.bodyStrong.fontSize * fontScale + 2 * space.sm;
  const fits = Math.floor((width + gap) / (chipWidth + gap));
  return Math.min(maxColumns, Math.max(1, fits));
};

/**
 * The start times of the chosen date and length as an even grid of chips
 * (board 28): taken ones struck through and not selectable, the earlier and
 * later ones behind a disclosure that opens by itself when the chosen start
 * is one of them. Reads as a radio group.
 */
export function MeetingRoomStartTimes({
  label,
  daytime,
  outside,
  selected,
  onSelect,
  locale,
}: {
  /** Names the group for assistive tech. */
  readonly label: string;
  readonly daytime: ReadonlyArray<MeetingRoomStartChoice>;
  /** The earlier and later starts, behind the disclosure. */
  readonly outside: ReadonlyArray<MeetingRoomStartChoice>;
  readonly selected: string | undefined;
  readonly onSelect: (startTime: string) => void;
  readonly locale: AppLocale;
}) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [opened, setOpened] = useState(false);
  const chosenOutside = outside.some(({ startTime }) => startTime === selected);
  const expanded = opened || chosenOutside;
  const shown = expanded
    ? [...daytime, ...outside].sort((first, second) =>
        first.startTime.localeCompare(second.startTime)
      )
    : daytime;
  const columns = startTimeColumns(width, fontScale);
  // Every chip gets the same share of the row, the last row's too.
  // Floored to half a point so rounding never pushes the last chip of a
  // row onto the next.
  const chipWidth =
    width > 0
      ? Math.floor(((width - gap * (columns - 1)) / columns) * 2) / 2
      : undefined;

  const chipRefs = useRef<Array<ComponentRef<typeof Pressable> | null>>([]);
  const free = shown.flatMap((choice, index) => (choice.taken ? [] : [index]));
  const tabStop =
    free[
      tabStopIndex(
        free.map((index) => shown[index]?.startTime),
        selected
      )
    ];
  const moveFrom = (index: number, key: string) => {
    const at = free.indexOf(index);
    const next = choiceIndexForKey(key, at, free.length);
    return next === undefined ? undefined : free[next];
  };

  return (
    <View style={styles.stack}>
      <View
        role="radiogroup"
        aria-label={label}
        style={styles.grid}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      >
        {shown.map((choice, index) => {
          const checked = !choice.taken && choice.startTime === selected;
          return (
            <Pressable
              key={choice.startTime}
              ref={(node) => {
                chipRefs.current[index] = node;
              }}
              role="radio"
              aria-checked={checked}
              aria-disabled={choice.taken}
              aria-label={
                choice.taken
                  ? m.booking_meeting_room_taken_start(
                      { time: choice.startTime },
                      { locale }
                    )
                  : undefined
              }
              disabled={choice.taken}
              tabIndex={index === tabStop ? 0 : -1}
              onPress={() => {
                if (!checked) onSelect(choice.startTime);
              }}
              onKeyDown={(event) => {
                const next = moveFrom(index, event.nativeEvent.key);
                if (next === undefined) return;
                event.preventDefault();
                chipRefs.current[next]?.focus();
                const target = shown[next];
                if (target !== undefined && target.startTime !== selected) {
                  onSelect(target.startTime);
                }
              }}
              style={({ pressed }) => [
                styles.chip,
                chipWidth === undefined
                  ? styles.unmeasured
                  : { width: chipWidth },
                chipLook(choice.taken, checked),
                pressed && !checked && !choice.taken && styles.pressed,
              ]}
            >
              <Text
                numeric
                variant="bodyStrong"
                style={[
                  styles.time,
                  checked && styles.checkedTime,
                  choice.taken && styles.takenTime,
                ]}
              >
                {choice.startTime}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {outside.length > 0 && !chosenOutside && (
        <Pressable
          role="button"
          aria-expanded={expanded}
          onPress={() => setOpened(!expanded)}
          style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
        >
          <Icon
            icon={expanded ? ChevronUp : ChevronDown}
            size={18}
            color={color.action}
          />
          <Text variant="label" tone="action" style={styles.moreText}>
            {expanded
              ? m.booking_meeting_room_fewer_times({}, { locale })
              : m.booking_meeting_room_more_times({}, { locale })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const chipLook = (taken: boolean, checked: boolean) => {
  if (taken) return styles.taken;
  return checked ? styles.checked : styles.free;
};

const styles = StyleSheet.create({
  stack: { rowGap: space.md },
  grid: { columnGap: gap, flexDirection: "row", flexWrap: "wrap", rowGap: gap },
  chip: {
    alignItems: "center",
    borderRadius: radius.tile,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
  },
  unmeasured: { width: "22%" },
  free: {
    backgroundColor: color.surface,
    borderColor: color.field,
    borderWidth: 1,
  },
  checked: {
    backgroundColor: color.action,
    boxShadow: "0 4px 10px -6px rgba(150, 48, 4, 0.8)",
  },
  taken: { backgroundColor: color.sunken },
  pressed: { backgroundColor: color.pressed },
  time: { textAlign: "center" },
  checkedTime: { color: color.white },
  takenTime: {
    color: color.disabledInk,
    fontVariationSettings: brandFontVariation(500),
    fontWeight: "500",
    textDecorationLine: "line-through",
  },
  more: {
    alignItems: "center",
    columnGap: 6,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 48,
  },
  morePressed: { opacity: 0.7 },
  moreText: { flexShrink: 1, textAlign: "center" },
});
