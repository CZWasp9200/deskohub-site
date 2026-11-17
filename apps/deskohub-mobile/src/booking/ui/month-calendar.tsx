import { brandFontVariation } from "@deskohub/brand-tokens";
import type { CustomerLocale } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Info from "lucide-react-native/icons/info";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { m } from "../../i18n/messages";
import { upperFirst } from "../../i18n/sentence-case";
import { Icon, type IconComponent } from "../../ui/icon";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { shrinkToFitLine } from "../../ui/shrink-to-fit";
import { Text } from "../../ui/text";
import {
  color,
  radius,
  shadow,
  space,
  touchTarget,
  typeScale,
} from "../../ui/tokens";
import type { DateChoice } from "../selection/booking-selection";
import {
  addMonthsToMonth,
  type PragueDate,
  type PragueMonth,
} from "../selection/prague-date";
import {
  type CalendarDay,
  type CalendarRange,
  initialCalendarMonth,
  monthCalendarModel,
} from "./month-calendar-model";

// Noon UTC on the calendar date, formatted in UTC, names the same day in
// every device time zone.
const utcNoon = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12));

const monthTitle = ({ year, month }: PragueMonth, locale: CustomerLocale) => {
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcNoon(year, month, 1));
  return upperFirst(title, locale);
};

// 1 January 2024 is a Monday, so its week names the weekdays Monday first.
const weekdayNames = (locale: CustomerLocale) => {
  const format = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(utcNoon(2024, 1, 1 + index))
  );
};

// A week's cells sit in fixed Monday-first columns, which key them.
const weekdayColumns = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Every week holds at least one day of the month; its first names the week.
const weekKey = (week: ReadonlyArray<Option.Option<CalendarDay>>) =>
  week.flatMap(Option.toArray)[0]?.date ?? "";

/**
 * A month of dates to pick one from, Monday first. It pages between the
 * months the dates span and follows the selection to its month; it never
 * picks a date itself. Past days are greyed, unavailable days struck
 * through, `today` ringed, and a `range` banded from its first to its last
 * day. With `onUnavailablePress`, tapping an unavailable day reports it
 * instead of selecting it, so the screen can focus it (`focusedDate`) and
 * explain it in the box under the grid (`dayInfo`).
 */
export function MonthCalendar({
  label,
  locale,
  dates,
  selected,
  onSelect,
  previousMonthLabel,
  nextMonthLabel,
  unavailableLabel,
  disabled = false,
  today,
  range,
  focusedDate,
  onUnavailablePress,
  dayInfo,
  legend = true,
}: {
  /** Names the calendar for assistive technology. */
  readonly label: string;
  readonly locale: CustomerLocale;
  readonly dates: DateChoice;
  readonly selected: PragueDate | undefined;
  readonly onSelect: (date: PragueDate) => void;
  readonly previousMonthLabel: string;
  readonly nextMonthLabel: string;
  /** Follows an unavailable day's date for assistive technology. */
  readonly unavailableLabel: string;
  readonly disabled?: boolean;
  /** Ringed, so the customer finds their place in the month. */
  readonly today?: PragueDate;
  /** An inclusive span of days to highlight, such as an office booking's. */
  readonly range?: CalendarRange;
  /** The unavailable day the customer tapped, ringed while `dayInfo` explains it. */
  readonly focusedDate?: PragueDate;
  /** Makes unavailable days tappable; never selects them. */
  readonly onUnavailablePress?: (date: PragueDate) => void;
  /** Why the focused day can't be booked, in a box under the grid. */
  readonly dayInfo?: string;
  /** The key to the today ring and the struck-through days. */
  readonly legend?: boolean;
}) {
  const [shownMonth, setShownMonth] = useState(() =>
    initialCalendarMonth(dates, selected)
  );
  const [followedSelection, setFollowedSelection] = useState(selected);
  if (selected !== followedSelection) {
    setFollowedSelection(selected);
    if (selected !== undefined) {
      setShownMonth(initialCalendarMonth(dates, selected));
    }
  }

  const calendar = monthCalendarModel({
    month: shownMonth,
    dates,
    selected,
    today,
    range,
    focused: focusedDate,
  });
  const dayName = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const todayLabel = m.booking_calendar_today_day({}, { locale });
  const dayLabel = ({ date, state, today: isToday }: CalendarDay) => {
    const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
    return [
      dayName.format(utcNoon(year, month, day)),
      isToday && todayLabel,
      state === "unavailable" && unavailableLabel,
    ]
      .filter(Boolean)
      .join(", ");
  };
  // VoiceOver doesn't announce live regions: tell it the explanation.
  useLiveRegionAnnouncement(dayInfo, "polite");
  const weekdays = weekdayNames(locale);
  const page = (months: number) =>
    setShownMonth(addMonthsToMonth(calendar.month, months));

  return (
    <View role="group" aria-label={label} style={styles.calendar}>
      <View style={styles.header}>
        <PageButton
          label={previousMonthLabel}
          icon={ChevronLeft}
          disabled={disabled || !calendar.canGoPrevious}
          onPress={() => page(-1)}
        />
        <Text variant="bodyStrong" aria-live="polite" style={styles.title}>
          {monthTitle(calendar.month, locale)}
        </Text>
        <PageButton
          label={nextMonthLabel}
          icon={ChevronRight}
          disabled={disabled || !calendar.canGoNext}
          onPress={() => page(1)}
        />
      </View>
      <View aria-hidden style={styles.week}>
        {weekdayColumns.map((column, columnIndex) => (
          <Text
            key={column}
            variant="badge"
            tone="muted"
            style={styles.weekday}
            // At 200% a weekday shrinks to its column, never splits.
            {...shrinkToFitLine}
          >
            {weekdays[columnIndex]}
          </Text>
        ))}
      </View>
      <View style={disabled && styles.inert}>
        {calendar.weeks.map((week) => (
          <View key={weekKey(week)} style={styles.week}>
            {weekdayColumns.map((column, columnIndex) => {
              const cell = week[columnIndex] ?? Option.none();
              if (Option.isNone(cell)) {
                return <View key={column} style={styles.cell} />;
              }
              const day = cell.value;
              const explains =
                day.state === "unavailable" && onUnavailablePress !== undefined;
              const picks =
                day.state === "available" || day.state === "selected";
              const inert = disabled || !(picks || explains);
              return (
                <Pressable
                  key={column}
                  role="button"
                  aria-label={dayLabel(day)}
                  aria-selected={
                    day.state === "selected" || Option.isSome(day.range)
                  }
                  aria-disabled={inert}
                  disabled={inert}
                  onPress={() =>
                    explains ? onUnavailablePress(day.date) : onSelect(day.date)
                  }
                  style={styles.cell}
                >
                  {({ pressed }) => (
                    <CalendarDayCell day={day} pressed={pressed && !inert} />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {legend && (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendMark, styles.todayDisc]} />
            <Text variant="caption" tone="muted">
              {m.booking_calendar_legend_today({}, { locale })}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendMark}>
              <View style={[styles.strike, styles.legendStrike]} />
            </View>
            <Text variant="caption" tone="muted">
              {m.booking_calendar_legend_unavailable({}, { locale })}
            </Text>
          </View>
        </View>
      )}
      {/* Stays mounted, so the explanation is announced when it appears. */}
      <View aria-live="polite" style={dayInfo !== undefined && styles.dayInfo}>
        {dayInfo !== undefined && (
          <>
            <View style={styles.dayInfoIcon}>
              <Icon icon={Info} size={18} />
            </View>
            <Text variant="bodySmall" tone="default" style={styles.dayInfoText}>
              {dayInfo}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

/** A day's disc, with the range band behind it. */
function CalendarDayCell({
  day,
  pressed,
}: {
  readonly day: CalendarDay;
  readonly pressed: boolean;
}) {
  const part = Option.getOrUndefined(day.range);
  const filled = day.state === "selected" || part === "start" || part === "end";
  return (
    <>
      {part !== undefined && (
        <View
          style={[
            styles.band,
            part === "start" && styles.bandStart,
            part === "end" && styles.bandEnd,
          ]}
        />
      )}
      <View
        style={[
          styles.disc,
          pressed && styles.pressedDisc,
          day.today && styles.todayDisc,
          filled && styles.selectedDisc,
          day.focused && styles.focusedDisc,
        ]}
      >
        <Text
          numeric
          style={[
            styles.dayNumber,
            (day.state === "past" || day.state === "outside-range") &&
              styles.pastNumber,
            day.state === "unavailable" && styles.unavailableNumber,
            part !== undefined && !filled && styles.bandNumber,
            filled && styles.selectedNumber,
          ]}
        >
          {day.day}
        </Text>
        {day.state === "unavailable" && <View style={styles.strike} />}
      </View>
    </>
  );
}

function PageButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly icon: IconComponent;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pageButton,
        pressed && !disabled && styles.pressedDisc,
      ]}
    >
      <Icon
        icon={icon}
        color={disabled ? color.pageArrowDisabled : color.navy}
      />
    </Pressable>
  );
}

const discSize = 40;

const styles = StyleSheet.create({
  calendar: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    paddingBottom: space.md,
    paddingHorizontal: 10,
    paddingTop: space.xs,
    ...shadow.group,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
  },
  title: { flex: 1, textAlign: "center" },
  pageButton: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  week: { flexDirection: "row" },
  weekday: {
    flex: 1,
    paddingBottom: 6,
    paddingTop: space.xxs,
    textAlign: "center",
  },
  cell: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  inert: { opacity: 0.5 },
  band: {
    backgroundColor: color.actionTint,
    bottom: 2,
    left: 0,
    position: "absolute",
    right: 0,
    top: 2,
  },
  bandStart: { left: "50%" },
  bandEnd: { right: "50%" },
  // At least 40 across; it grows with large text rather than clipping it.
  disc: {
    alignItems: "center",
    borderRadius: radius.pill,
    // Android drops the radius of a view that gains an outer shadow after
    // it mounts, squaring a day once it's picked: every disc carries the
    // selected disc's shadow, clear until picked.
    boxShadow: "0 4px 10px -6px rgba(150, 48, 4, 0)",
    justifyContent: "center",
    minHeight: discSize,
    minWidth: discSize,
  },
  pressedDisc: { backgroundColor: color.pressed },
  todayDisc: { boxShadow: `inset 0 0 0 1.5px ${color.navy}` },
  selectedDisc: {
    backgroundColor: color.action,
    boxShadow: "0 4px 10px -6px rgba(150, 48, 4, 0.8)",
  },
  focusedDisc: {
    outlineColor: color.action,
    outlineOffset: 1,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
  dayNumber: {
    ...typeScale.subhead,
    color: color.navy,
    fontVariationSettings: brandFontVariation(500),
    fontWeight: "500",
  },
  pastNumber: { color: color.calendarPast },
  unavailableNumber: { color: color.calendarUnavailable },
  bandNumber: {
    color: color.actionPressed,
    fontVariationSettings: brandFontVariation(600),
    fontWeight: "600",
  },
  selectedNumber: {
    color: color.white,
    fontVariationSettings: brandFontVariation(700),
    fontWeight: "700",
  },
  // A short diagonal line through the day number.
  strike: {
    backgroundColor: color.calendarUnavailable,
    height: 1.5,
    left: 11,
    position: "absolute",
    right: 11,
    top: "50%",
    transform: [{ rotate: "-35deg" }],
  },
  legend: {
    columnGap: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 6,
    paddingTop: 10,
    rowGap: space.xs,
  },
  legendItem: { alignItems: "center", flexDirection: "row", gap: 6 },
  legendMark: { borderRadius: 7, height: 14, width: 14 },
  legendStrike: { left: 1, right: 1, top: 6 },
  dayInfo: {
    alignItems: "flex-start",
    backgroundColor: color.sunken,
    borderRadius: radius.tile,
    flexDirection: "row",
    gap: 10,
    marginHorizontal: space.xxs,
    marginTop: 10,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  dayInfoIcon: { marginTop: 1 },
  dayInfoText: { flex: 1 },
});
