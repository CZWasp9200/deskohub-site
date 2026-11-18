import type {
  CustomerAvailability,
  CustomerBookableDates,
  CustomerBookingSelection,
  CustomerMeetingRoomDuration,
  CustomerMeetingRoomStartTimes,
  CustomerMeetingRoomUnavailableDates,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, Data, Option, Result } from "effect";
import {
  type AvailabilityQuery,
  type DateChoice,
  SelectionIncomplete,
} from "./booking-selection";
import { addDays, type PragueDate, pragueToday } from "./prague-date";

/**
 * A meeting-room booking the customer is putting together: a date, then a
 * length, then a start for the hourly lengths. Each stays empty until the
 * customer chooses it or the screen opens on a booked selection.
 */
export type MeetingRoomDraft = {
  readonly date: Option.Option<PragueDate>;
  readonly duration: Option.Option<CustomerMeetingRoomDuration>;
  /** Prague start time, HH:mm, for the hourly lengths; a whole day has none. */
  readonly startTime: Option.Option<string>;
  /** The room opens 15 minutes early for setup, at no cost. */
  readonly earlySetup: boolean;
};

/** One free start the server offers for a date and a length. */
export type MeetingRoomStart =
  CustomerMeetingRoomStartTimes["startTimes"][number];

type MeetingRoomOffering = Extract<
  CustomerOffering,
  { readonly family: "meeting-room" }
>;

/** The meeting-room offerings, one per length, in catalog order. */
export const meetingRoomOfferings = (
  offerings: ReadonlyArray<CustomerOffering>
): ReadonlyArray<MeetingRoomOffering> =>
  offerings.filter(
    (offering): offering is MeetingRoomOffering =>
      offering.family === "meeting-room"
  );

/** The draft a screen opened without a selection starts from. */
export const emptyMeetingRoomDraft: MeetingRoomDraft = {
  date: Option.none(),
  duration: Option.none(),
  startTime: Option.none(),
  earlySetup: false,
};

const isWholeDay = (duration: CustomerMeetingRoomDuration) =>
  duration === "day:1";

/**
 * The draft for a booked selection ("Book again"): its length when the
 * catalog still offers it, its date when that can still be booked, its start
 * for an hourly length and its early setup. None for another family.
 */
export const meetingRoomDraftFromSelection = (
  {
    selection,
    earlySetup,
  }: {
    readonly selection: CustomerBookingSelection;
    readonly earlySetup?: boolean;
  },
  offerings: ReadonlyArray<CustomerOffering>,
  { earliest, latest }: CustomerBookableDates
): Option.Option<MeetingRoomDraft> => {
  if (selection.family !== "meeting-room") return Option.none();
  const duration = Option.fromNullishOr(selection.duration).pipe(
    Option.filter((wanted) =>
      meetingRoomOfferings(offerings).some(
        (offering) => offering.duration === wanted
      )
    )
  );
  const hourly = Option.exists(duration, (chosen) => !isWholeDay(chosen));
  return Option.some({
    date: Option.liftPredicate(
      selection.date,
      (date) => date >= earliest && date <= latest
    ),
    duration,
    startTime: hourly
      ? Option.fromNullishOr(selection.startTime)
      : Option.none(),
    earlySetup: hourly && earlySetup === true,
  });
};

/**
 * The draft on another date. The chosen length, start and early setup carry
 * over; the screen shows the start taken, or drops early setup, once the new
 * date's starts load.
 */
export const selectMeetingRoomDate = (
  draft: MeetingRoomDraft,
  date: PragueDate
): MeetingRoomDraft => ({ ...draft, date: Option.some(date) });

/**
 * The draft with another length. The chosen start carries over; a whole day
 * has no early setup.
 */
export const selectMeetingRoomDuration = (
  draft: MeetingRoomDraft,
  duration: CustomerMeetingRoomDuration
): MeetingRoomDraft => ({
  ...draft,
  duration: Option.some(duration),
  earlySetup: !isWholeDay(duration) && draft.earlySetup,
});

/** The draft with the customer's start time. */
export const selectMeetingRoomStartTime = (
  draft: MeetingRoomDraft,
  startTime: string
): MeetingRoomDraft => ({ ...draft, startTime: Option.some(startTime) });

/** HH:mm of a start's Prague local date-time, YYYY-MM-DDTHH:mm. */
const startTimeOf = (start: { readonly startDateTime: string }) =>
  start.startDateTime.slice(11, 16);

/**
 * The booking the draft names. A whole day takes no start time; an hourly
 * booking is incomplete without one.
 */
export const toMeetingRoomSelection = (
  draft: MeetingRoomDraft
): Result.Result<CustomerBookingSelection, SelectionIncomplete> => {
  if (Option.isNone(draft.date) || Option.isNone(draft.duration)) {
    return Result.fail(
      new SelectionIncomplete({
        missing: [
          ...(Option.isNone(draft.date) ? (["date"] as const) : []),
          ...(Option.isNone(draft.duration) ? (["duration"] as const) : []),
        ],
      })
    );
  }
  const base = {
    family: "meeting-room",
    date: draft.date.value,
    duration: draft.duration.value,
  } as const;
  if (isWholeDay(base.duration)) return Result.succeed(base);
  return Option.match(draft.startTime, {
    onNone: () =>
      Result.fail(new SelectionIncomplete({ missing: ["startTime"] })),
    onSome: (startTime) => Result.succeed({ ...base, startTime }),
  });
};

/**
 * The query for the starts of the draft's date and length; none until both
 * are chosen.
 */
export const meetingRoomStartTimesQuery = (
  draft: MeetingRoomDraft
): Option.Option<{
  readonly date: PragueDate;
  readonly duration: CustomerMeetingRoomDuration;
}> => Option.all({ date: draft.date, duration: draft.duration });

/** The starts loaded for the draft's date and length, if those are loaded. */
const startTimesFor = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>
) =>
  Option.filter(startTimes, (loaded) =>
    Option.exists(
      meetingRoomStartTimesQuery(draft),
      ({ date, duration }) =>
        loaded.date === date && loaded.duration === duration
    )
  );

/** The loaded starts whose interval hasn't ended at `now`. */
const withoutEnded = (
  loaded: CustomerMeetingRoomStartTimes,
  now: Date
): CustomerMeetingRoomStartTimes => {
  const running = (start: { readonly endsAt: string }) =>
    new Date(start.endsAt).getTime() > now.getTime();
  return {
    ...loaded,
    startTimes: loaded.startTimes.filter(running),
    unavailableStartTimes: loaded.unavailableStartTimes.filter(running),
  };
};

/** The free start the draft books, among starts loaded for it. */
const chosenStart = (
  draft: MeetingRoomDraft,
  startTimes: CustomerMeetingRoomStartTimes
): Option.Option<MeetingRoomStart> =>
  isWholeDay(startTimes.duration)
    ? Arr.head(startTimes.startTimes)
    : Option.flatMap(draft.startTime, (startTime) =>
        Arr.findFirst(
          startTimes.startTimes,
          (start) => startTimeOf(start) === startTime
        )
      );

/**
 * The availability query for the interval the draft books, built from its
 * free start: Prague dates from the start's day to the day the booking last
 * touches, and the interval's instants. None until the start is known.
 */
export const meetingRoomAvailabilityQuery = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>
): Option.Option<AvailabilityQuery> =>
  startTimesFor(draft, startTimes).pipe(
    Option.flatMap((loaded) =>
      Option.map(chosenStart(draft, loaded), (start) => ({
        kind: "meeting-room" as const,
        from: loaded.date,
        // A booking ending at midnight doesn't touch the next day.
        to: pragueToday(new Date(new Date(start.endsAt).getTime() - 1)),
        startsAt: start.startsAt,
        endsAt: start.endsAt,
      }))
    )
  );

/**
 * The draft fitted to the starts loaded for it: early setup clears unless
 * the chosen start offers it. A chosen start no longer free is kept, and the
 * screen shows it taken. Starts loaded for another date or length change
 * nothing.
 */
export const reconcileMeetingRoomDraft = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>,
  now: Date
): MeetingRoomDraft => {
  if (!draft.earlySetup) return draft;
  return Option.match(
    Option.map(startTimesFor(draft, startTimes), (loaded) =>
      withoutEnded(loaded, now)
    ),
    {
      onNone: () => draft,
      onSome: (loaded) =>
        Option.exists(
          chosenStart(draft, loaded),
          (start) => start.earlySetupAvailable && !isWholeDay(loaded.duration)
        )
          ? draft
          : { ...draft, earlySetup: false },
    }
  );
};

/** Why a meeting-room draft can't continue to checkout. */
export type MeetingRoomBlocker = Data.TaggedEnum<{
  DateRequired: Record<never, never>;
  DateOutOfRange: Record<never, never>;
  DurationRequired: Record<never, never>;
  /** The starts or the interval's availability haven't loaded. */
  AvailabilityPending: Record<never, never>;
  /** The chosen length has no free start on the date. */
  NoFreeStart: Record<never, never>;
  /** An hourly length is chosen and some start is free, but none is chosen. */
  StartRequired: Record<never, never>;
  /** The chosen start isn't free or has ended. */
  StartUnavailable: Record<never, never>;
}>;
export const MeetingRoomBlocker = Data.taggedEnum<MeetingRoomBlocker>();

/** One start time as the screen offers it. */
export type MeetingRoomStartChoice = {
  /** HH:mm, Prague time. */
  readonly startTime: string;
  /** Already booked: shown struck through, never chosen. */
  readonly taken: boolean;
  readonly earlySetupAvailable: boolean;
};

/** The first and last start hours shown before the disclosure opens. */
const daytimeStartHours = { first: 8, last: 19 } as const;

/**
 * Every start of the date and length not yet ended, free and taken, in time
 * order: `daytime` from 08:00 through 19:00, `outside` the earlier and later
 * ones the screen keeps behind a disclosure.
 */
export const meetingRoomStartChoices = (
  loaded: CustomerMeetingRoomStartTimes,
  now: Date
): {
  readonly daytime: ReadonlyArray<MeetingRoomStartChoice>;
  readonly outside: ReadonlyArray<MeetingRoomStartChoice>;
} => {
  const current = withoutEnded(loaded, now);
  const choices = [
    ...current.startTimes.map((start) => ({
      startDateTime: start.startDateTime,
      startTime: startTimeOf(start),
      taken: false,
      earlySetupAvailable: start.earlySetupAvailable,
    })),
    ...current.unavailableStartTimes.map((start) => ({
      startDateTime: start.startDateTime,
      startTime: startTimeOf(start),
      taken: true,
      earlySetupAvailable: false,
    })),
  ]
    .sort((first, second) =>
      first.startDateTime.localeCompare(second.startDateTime)
    )
    .map(
      ({ startDateTime: _startDateTime, ...choice }): MeetingRoomStartChoice =>
        choice
    );
  const isDaytime = ({ startTime }: MeetingRoomStartChoice) => {
    const hour = Number(startTime.slice(0, 2));
    return hour >= daytimeStartHours.first && hour <= daytimeStartHours.last;
  };
  return {
    daytime: choices.filter(isDaytime),
    outside: choices.filter((choice) => !isDaytime(choice)),
  };
};

/**
 * What is still free when the chosen length has no free start on the date:
 * the other lengths free that day, and the next day this length is free.
 * Read only from the meeting-room calendar's coverage; a length or a day the
 * calendar doesn't cover is never suggested.
 */
export type MeetingRoomAlternatives = {
  readonly durations: ReadonlyArray<CustomerMeetingRoomDuration>;
  readonly nextDate: Option.Option<PragueDate>;
};

export const meetingRoomAlternatives = ({
  date,
  duration,
  calendar,
  offered,
  latest,
}: {
  readonly date: PragueDate;
  readonly duration: CustomerMeetingRoomDuration;
  readonly calendar: CustomerMeetingRoomUnavailableDates;
  /** The lengths the catalog offers, in its order. */
  readonly offered: ReadonlyArray<CustomerMeetingRoomDuration>;
  /** The last date a meeting room can be booked on. */
  readonly latest: PragueDate;
}): MeetingRoomAlternatives => {
  const unavailableFor = (wanted: CustomerMeetingRoomDuration) =>
    Option.map(
      Arr.findFirst(calendar.durations, (entry) => entry.duration === wanted),
      (entry) => new Set(entry.unavailableDates)
    );
  const covers = (day: PragueDate) =>
    day >= calendar.from && day <= calendar.to;
  const durations = covers(date)
    ? offered.filter(
        (other) =>
          other !== duration &&
          Option.exists(unavailableFor(other), (taken) => !taken.has(date))
      )
    : [];
  const last = calendar.to < latest ? calendar.to : latest;
  const nextDate = Option.flatMap(unavailableFor(duration), (taken) => {
    for (let day = addDays(date, 1); day <= last; day = addDays(day, 1)) {
      if (covers(day) && !taken.has(day)) return Option.some(day);
    }
    return Option.none();
  });
  return { durations, nextDate };
};

/** What a meeting-room screen offers and disables for its draft. */
export type MeetingRoomEnablement = {
  readonly dates: DateChoice;
  /** The starts of the draft's date and length; none until they load. */
  readonly startChoices: Option.Option<
    ReturnType<typeof meetingRoomStartChoices>
  >;
  /** Whether the chosen start lets the room open early for setup. */
  readonly earlySetupAvailable: boolean;
  /** What is still free, while the chosen length has no free start. */
  readonly alternatives: Option.Option<MeetingRoomAlternatives>;
  readonly notices: CustomerAvailability["notices"];
  readonly blockers: ReadonlyArray<MeetingRoomBlocker>;
};

export const meetingRoomEnablement = (
  draft: MeetingRoomDraft,
  context: {
    readonly now: Date;
    /** The latest starts read, for any date and length. */
    readonly startTimes: Option.Option<CustomerMeetingRoomStartTimes>;
    /** Availability settled for `meetingRoomAvailabilityQuery`. */
    readonly availability: Option.Option<CustomerAvailability>;
    /** The meeting-room calendar: days with no free start, per length. */
    readonly calendar: Option.Option<CustomerMeetingRoomUnavailableDates>;
    /** The lengths the catalog offers, in its order. */
    readonly offered: ReadonlyArray<CustomerMeetingRoomDuration>;
    /** The dates the meeting-room offerings can be booked on. */
    readonly bookableDates: CustomerBookableDates;
  }
): MeetingRoomEnablement => {
  const { earliest, latest } = context.bookableDates;
  const loaded = Option.map(
    startTimesFor(draft, context.startTimes),
    (starts) => withoutEnded(starts, context.now)
  );
  const start = Option.flatMap(loaded, (starts) => chosenStart(draft, starts));
  const noFreeStart = Option.exists(
    loaded,
    (starts) => starts.startTimes.length === 0
  );

  const blockers: Array<MeetingRoomBlocker> = [];
  if (Option.isNone(draft.date)) {
    blockers.push(MeetingRoomBlocker.DateRequired());
  } else if (draft.date.value < earliest || draft.date.value > latest) {
    blockers.push(MeetingRoomBlocker.DateOutOfRange());
  } else if (Option.isNone(draft.duration)) {
    blockers.push(MeetingRoomBlocker.DurationRequired());
  } else if (Option.isNone(loaded)) {
    blockers.push(MeetingRoomBlocker.AvailabilityPending());
  } else if (noFreeStart) {
    blockers.push(MeetingRoomBlocker.NoFreeStart());
  } else if (
    !isWholeDay(draft.duration.value) &&
    Option.isNone(draft.startTime)
  ) {
    blockers.push(MeetingRoomBlocker.StartRequired());
  } else if (Option.isNone(start)) {
    blockers.push(MeetingRoomBlocker.StartUnavailable());
  } else if (Option.isNone(context.availability)) {
    blockers.push(MeetingRoomBlocker.AvailabilityPending());
  } else if (context.availability.value.meetingRoomUnavailable) {
    blockers.push(MeetingRoomBlocker.StartUnavailable());
  }

  const alternatives = noFreeStart
    ? Option.map(
        Option.all({
          date: draft.date,
          duration: draft.duration,
          calendar: context.calendar,
        }),
        ({ date, duration, calendar }) =>
          meetingRoomAlternatives({
            date,
            duration,
            calendar,
            offered: context.offered,
            latest,
          })
      )
    : Option.none();

  return {
    dates: {
      earliest,
      latest,
      unavailable: new Set(
        Option.match(context.calendar, {
          onNone: () => [],
          onSome: (calendar) => calendar.unavailableDates,
        })
      ),
    },
    startChoices: Option.map(startTimesFor(draft, context.startTimes), (all) =>
      meetingRoomStartChoices(all, context.now)
    ),
    earlySetupAvailable: Option.exists(
      start,
      (free) =>
        free.earlySetupAvailable &&
        Option.exists(draft.duration, (chosen) => !isWholeDay(chosen))
    ),
    alternatives,
    notices: Option.match(context.availability, {
      onNone: () => [],
      onSome: (availability) => availability.notices,
    }),
    blockers,
  };
};
