import type {
  CustomerAvailability,
  CustomerBookableDates,
  CustomerBookingSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Data, Option } from "effect";
import type { AvailabilityQuery, DateChoice } from "./booking-selection";
import {
  addDays,
  daysBetween,
  hoursBetweenMidnights,
  type PragueDate,
} from "./prague-date";

/** An office booking the customer is putting together. */
export type OfficeDraft = {
  /** The first day; none until the customer picks one. */
  readonly date: Option.Option<PragueDate>;
  /** Days booked from `date`, inclusive. */
  readonly dayCount: number;
  readonly seats: number;
};

export type OfficeOffering = Extract<
  CustomerOffering,
  { readonly family: "office" }
>;

/** The draft an office screen opens with: no day picked, one day, one seat. */
export const emptyOfficeDraft: OfficeDraft = {
  date: Option.none(),
  dayCount: 1,
  seats: 1,
};

/** The last day a stay of `dayCount` days from `date` books. */
export const officeLastDate = (date: PragueDate, dayCount: number) =>
  addDays(date, dayCount - 1);

/** The booking the draft names, as the quote and checkout take it, once it has a first day. */
export const toOfficeSelection = (
  draft: OfficeDraft
): Option.Option<CustomerBookingSelection> =>
  Option.map(draft.date, (date) => ({
    family: "office",
    date,
    endDate: officeLastDate(date, draft.dayCount),
    seats: draft.seats,
  }));

/**
 * The draft a booked office selection ("Book again") opens: its first day
 * while the calendar still offers it, its days and its seats. The screen
 * brings the days and seats within what the office then allows.
 */
export const officeDraftFromSelection = (
  selection: CustomerBookingSelection,
  { earliest, latest }: CustomerBookableDates
): Option.Option<OfficeDraft> => {
  if (selection.family !== "office") return Option.none();
  const endDate = selection.endDate ?? selection.date;
  return Option.some({
    date: Option.liftPredicate(
      selection.date,
      (date) => date >= earliest && date <= latest
    ),
    dayCount: Math.max(1, daysBetween(selection.date, endDate) + 1),
    seats: Math.max(1, selection.seats ?? 1),
  });
};

/** The draft on the first day the customer picked. */
export const selectOfficeDate = (
  draft: OfficeDraft,
  date: PragueDate
): OfficeDraft => ({ ...draft, date: Option.some(date) });

/** The availability query across the office offering's bookable dates. */
export const officeAvailabilityQuery = ({
  earliest,
  latest,
}: CustomerBookableDates): AvailabilityQuery => ({
  kind: "office",
  from: earliest,
  to: latest,
});

/**
 * The most days a booking from `date` can span: up to `latest` and before
 * the first unavailable day, and no more than `maximumDurationHours` between
 * the Prague midnights it starts and ends on. Zero when `date` itself
 * can't be booked.
 */
export const maximumOfficeDayCount = (input: {
  readonly date: PragueDate;
  readonly latest: PragueDate;
  readonly unavailableDates: ReadonlyArray<string>;
  readonly maximumDurationHours: number;
}): number => {
  const firstUnavailable = input.unavailableDates
    .filter((date) => date >= input.date && date <= input.latest)
    .sort()[0];
  const lastAvailable =
    firstUnavailable === undefined
      ? input.latest
      : addDays(firstUnavailable, -1);
  let dayCount = Math.max(0, daysBetween(input.date, lastAvailable) + 1);
  // Each day is 23 to 25 hours, so this steps back at most a day or two.
  while (
    dayCount > 0 &&
    hoursBetweenMidnights(input.date, addDays(input.date, dayCount)) >
      input.maximumDurationHours
  ) {
    dayCount -= 1;
  }
  return dayCount;
};

/** Why an office draft can't continue to checkout. */
export type OfficeBlocker = Data.TaggedEnum<{
  /** No first day is picked yet. */
  DateRequired: Record<never, never>;
  /** The horizon's availability hasn't loaded. */
  AvailabilityPending: Record<never, never>;
  /** The first day is outside the horizon or taken. */
  DateUnavailable: Record<never, never>;
  /**
   * The office is taken, or the stay too long, within the days drafted, or
   * the count isn't a whole number of days.
   */
  DayCountUnavailable: { readonly maximumDayCount: number };
  /** More seats than the office has, or not a whole positive number. */
  SeatsUnavailable: { readonly maximumSeats: Option.Option<number> };
}>;
export const OfficeBlocker = Data.taggedEnum<OfficeBlocker>();

/** What an office screen offers and disables for its draft. */
export type OfficeEnablement = {
  readonly dates: DateChoice;
  /** The most days the drafted first day allows; zero when it allows none. */
  readonly maximumDayCount: number;
  /**
   * The most seats the office takes; none while the office capacity can't
   * be read, when the screen keeps the drafted seats and checkout checks
   * them against the capacity.
   */
  readonly maximumSeats: Option.Option<number>;
  readonly notices: CustomerAvailability["notices"];
  readonly blockers: ReadonlyArray<OfficeBlocker>;
};

/** Whether `count` is a whole number from 1 up to `maximum`, when known. */
const isCountWithin = (count: number, maximum: Option.Option<number>) =>
  Number.isInteger(count) &&
  count >= 1 &&
  Option.match(maximum, {
    onNone: () => true,
    onSome: (most) => count <= most,
  });

export const officeEnablement = (
  draft: OfficeDraft,
  context: {
    readonly offering: OfficeOffering;
    /** Availability settled for `officeAvailabilityQuery`. */
    readonly availability: Option.Option<CustomerAvailability>;
  }
): OfficeEnablement => {
  const { earliest, latest } = context.offering.bookableDates;
  const unavailableDates = Option.match(context.availability, {
    onNone: () => [],
    onSome: (availability) => availability.unavailableDates,
  });
  const maximumDayCount = Option.match(draft.date, {
    onNone: () => 0,
    onSome: (date) =>
      date >= earliest && date <= latest
        ? maximumOfficeDayCount({
            date,
            latest,
            unavailableDates,
            maximumDurationHours: context.offering.maximumDurationHours,
          })
        : 0,
  });
  const maximumSeats = Option.fromNullishOr(context.offering.maximumSeats);

  const blockers: Array<OfficeBlocker> = [];
  if (Option.isNone(context.availability)) {
    blockers.push(OfficeBlocker.AvailabilityPending());
  }
  if (Option.isNone(draft.date)) {
    blockers.push(OfficeBlocker.DateRequired());
  } else if (maximumDayCount === 0) {
    blockers.push(OfficeBlocker.DateUnavailable());
  } else if (!isCountWithin(draft.dayCount, Option.some(maximumDayCount))) {
    blockers.push(OfficeBlocker.DayCountUnavailable({ maximumDayCount }));
  }
  if (!isCountWithin(draft.seats, maximumSeats)) {
    blockers.push(OfficeBlocker.SeatsUnavailable({ maximumSeats }));
  }

  return {
    dates: { earliest, latest, unavailable: new Set(unavailableDates) },
    maximumDayCount,
    maximumSeats,
    notices: Option.match(Option.all([context.availability, draft.date]), {
      onNone: () => [],
      onSome: ([availability, date]) => {
        const lastDate = officeLastDate(date, draft.dayCount);
        return availability.notices.filter(
          (notice) => notice.date >= date && notice.date <= lastDate
        );
      },
    }),
    blockers,
  };
};

/**
 * The draft with its day count and seats brought to whole numbers within
 * what the enablement allows. A first day that allows no days (or none
 * picked yet) keeps the draft's count; unknown capacity
 * keeps the drafted seats.
 */
const clampCount = (count: number, maximum: Option.Option<number>) => {
  const atLeastOne = Math.max(Math.trunc(count), 1);
  return Option.match(maximum, {
    onNone: () => atLeastOne,
    onSome: (most) => Math.min(atLeastOne, most),
  });
};

export const clampOfficeDraft = (
  draft: OfficeDraft,
  enablement: Pick<OfficeEnablement, "maximumDayCount" | "maximumSeats">
): OfficeDraft => {
  const dayCount =
    enablement.maximumDayCount === 0
      ? draft.dayCount
      : clampCount(draft.dayCount, Option.some(enablement.maximumDayCount));
  const seats = clampCount(draft.seats, enablement.maximumSeats);
  return dayCount === draft.dayCount && seats === draft.seats
    ? draft
    : { ...draft, dayCount, seats };
};
