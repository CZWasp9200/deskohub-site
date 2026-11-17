import type {
  CustomerAvailability,
  CustomerBookableDates,
  CustomerBookedSelection,
  CustomerBookingSelection,
  CustomerMeetingRoomStartTimes,
  CustomerMeetingRoomUnavailableDates,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Equal, Option, Result } from "effect";
import { bookingPreselectionKey } from "../booking-preselection";
import type { AvailabilityQuery } from "../selection/booking-selection";
import {
  emptyMeetingRoomDraft,
  type MeetingRoomDraft,
  type MeetingRoomEnablement,
  meetingRoomAvailabilityQuery,
  meetingRoomDraftFromSelection,
  meetingRoomEnablement,
  meetingRoomOfferings,
  reconcileMeetingRoomDraft,
  toMeetingRoomSelection,
} from "../selection/meeting-room-selection";
import { quotableSelection } from "./booking-family-view";

/** The meeting-room draft the screen keeps, with the preselection it grew from. */
export interface KeptMeetingRoomDraft {
  /** The preselection's key (`bookingPreselectionKey`); empty without one. */
  readonly seed: string;
  readonly draft: MeetingRoomDraft;
}

/**
 * The draft the meeting-room screen shows: the one it keeps, unless the
 * screen was opened on another preselection ("Book again"), which then
 * replaces it; else the preselection's draft, else an empty one. Without a
 * preselection the kept draft stays, so a restarted checkout comes back to
 * the customer's choices.
 */
export const openingMeetingRoomDraft = ({
  kept,
  preselection,
  offerings,
  bookableDates,
}: {
  readonly kept: Option.Option<KeptMeetingRoomDraft>;
  readonly preselection: Option.Option<CustomerBookedSelection>;
  readonly offerings: ReadonlyArray<CustomerOffering>;
  /** The dates the meeting-room offerings can be booked on. */
  readonly bookableDates: CustomerBookableDates;
}): MeetingRoomDraft => {
  const seed = bookingPreselectionKey(preselection);
  return Option.filter(
    kept,
    (draft) => seed === "" || draft.seed === seed
  ).pipe(
    Option.map(({ draft }) => draft),
    Option.orElse(() =>
      Option.flatMap(preselection, (booked) =>
        meetingRoomDraftFromSelection(booked, offerings, bookableDates)
      )
    ),
    Option.getOrElse(() => emptyMeetingRoomDraft)
  );
};

/** What the meeting-room screen shows for its draft and the reads so far. */
export type MeetingRoomBookingModel = {
  /** The draft with early setup fitted to the chosen start. */
  readonly draft: MeetingRoomDraft;
  readonly enablement: MeetingRoomEnablement;
  readonly selection: Option.Option<CustomerBookingSelection>;
  readonly quotable: Option.Option<CustomerBookingSelection>;
};

/**
 * The availability query the screen reads: the settled (debounced) draft's,
 * once its starts have loaded.
 */
export const meetingRoomQueryOf = (
  settled: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>,
  now: Date
): Option.Option<AvailabilityQuery> =>
  meetingRoomAvailabilityQuery(
    reconcileMeetingRoomDraft(settled, startTimes, now),
    startTimes
  );

export const meetingRoomBookingModel = ({
  draft,
  settled,
  now,
  offerings,
  bookableDates,
  startTimes,
  calendar,
  availability,
}: {
  /** The draft as the customer last changed it. */
  readonly draft: MeetingRoomDraft;
  /** The draft once unchanged for the debounce, which the reads are for. */
  readonly settled: MeetingRoomDraft;
  readonly now: Date;
  readonly offerings: ReadonlyArray<CustomerOffering>;
  /** The dates the meeting-room offerings can be booked on. */
  readonly bookableDates: CustomerBookableDates;
  /** The latest starts read, for any date and length. */
  readonly startTimes: Option.Option<CustomerMeetingRoomStartTimes>;
  /** The meeting-room calendar, once read. */
  readonly calendar: Option.Option<CustomerMeetingRoomUnavailableDates>;
  /** The availability read for `query`, with the query it answers. */
  readonly availability: Option.Option<{
    readonly query: AvailabilityQuery;
    readonly value: CustomerAvailability;
  }>;
}): MeetingRoomBookingModel => {
  const fitted = reconcileMeetingRoomDraft(draft, startTimes, now);
  const query = meetingRoomAvailabilityQuery(fitted, startTimes);
  // Availability read for an earlier draft (inside the debounce) doesn't
  // answer this one.
  const current = Option.flatMap(availability, (read) =>
    Option.exists(query, (wanted) => Equal.equals(wanted, read.query))
      ? Option.some(read.value)
      : Option.none()
  );
  const enablement = meetingRoomEnablement(fitted, {
    now,
    startTimes,
    availability: current,
    calendar,
    offered: meetingRoomOfferings(offerings).map(({ duration }) => duration),
    bookableDates,
  });
  const selection = Result.getSuccess(toMeetingRoomSelection(fitted));
  // Quoted only once the selection has settled, like its availability, so
  // quick changes spend no quote reads on the drafts in between.
  const settledSelection = Result.getSuccess(
    toMeetingRoomSelection(reconcileMeetingRoomDraft(settled, startTimes, now))
  );
  return {
    draft: fitted,
    enablement,
    selection,
    quotable: Option.filter(
      quotableSelection(selection, enablement.blockers),
      (current) =>
        Option.exists(settledSelection, (answered) =>
          Equal.equals(current, answered)
        )
    ),
  };
};
