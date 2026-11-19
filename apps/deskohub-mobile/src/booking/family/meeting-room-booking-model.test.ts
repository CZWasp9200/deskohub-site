import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import { bookingPreselectionKey } from "../booking-preselection";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  meetingRoomStartTimesAtom,
  meetingRoomUnavailableDatesAtom,
} from "../data/booking-queries";
import {
  emptyMeetingRoomDraft,
  type MeetingRoomDraft,
  selectMeetingRoomDate,
  selectMeetingRoomDuration,
  selectMeetingRoomStartTime,
} from "../selection/meeting-room-selection";
import { fakeBooking } from "../testing/fake-booking-api";
import {
  meetingRoomBookingModel,
  meetingRoomQueryOf,
  openingMeetingRoomDraft,
} from "./meeting-room-booking-model";
import { settledValue } from "./testing/settled-value";

const now = new Date();

const setup = async () => {
  const data = makeFakeCustomerData("linked");
  const booking = fakeBooking(data.workspace);
  const catalog = await settledValue(
    data.registry,
    bookingOfferingsAtom("en-US")
  );
  const calendar = await settledValue(
    data.registry,
    meetingRoomUnavailableDatesAtom
  );
  const oneHour = selectMeetingRoomDuration(
    selectMeetingRoomDate(emptyMeetingRoomDraft, booking.dateIn(2)),
    "hour:1"
  );
  const startTimes = await settledValue(
    data.registry,
    meetingRoomStartTimesAtom({ date: booking.dateIn(2), duration: "hour:1" })
  );
  const firstFree = startTimes.startTimes[0]?.startDateTime.slice(11, 16);
  const draft = selectMeetingRoomStartTime(oneHour, firstFree ?? "");
  return {
    ...data,
    booking,
    offerings: catalog.offerings,
    // The meeting-room offerings share one bookable window.
    bookableDates: Option.getOrThrow(
      Option.fromNullishOr(
        catalog.offerings.find(({ family }) => family === "meeting-room")
      )
    ).bookableDates,
    calendar,
    oneHour,
    draft,
    startTimes,
  };
};

describe("openingMeetingRoomDraft", () => {
  const bookAgain = Option.some({
    selection: {
      family: "meeting-room" as const,
      date: "2099-01-01",
      duration: "hour:4" as const,
      startTime: "09:00",
    },
    earlySetup: true,
  });

  test("opens empty without a preselection", async () => {
    const { offerings, bookableDates } = await setup();

    expect(
      openingMeetingRoomDraft({
        kept: Option.none(),
        preselection: Option.none(),
        offerings,
        bookableDates,
      })
    ).toEqual(emptyMeetingRoomDraft);
  });

  test("opens on a booked selection's length, date, start and early setup", async () => {
    const { booking, offerings, bookableDates } = await setup();
    const date = booking.dateIn(5);
    const preselection = Option.map(bookAgain, (booked) => ({
      ...booked,
      selection: { ...booked.selection, date },
    }));

    expect(
      openingMeetingRoomDraft({
        kept: Option.none(),
        preselection,
        offerings,
        bookableDates,
      })
    ).toEqual({
      date: Option.some(date),
      duration: Option.some("hour:4"),
      startTime: Option.some("09:00"),
      earlySetup: true,
    });
  });

  test("keeps the customer's changes, unless another preselection opens the screen", async () => {
    const { offerings, oneHour, bookableDates } = await setup();
    const fromBookAgain = {
      seed: bookingPreselectionKey(bookAgain),
      draft: oneHour,
    };
    const opening = (
      kept: typeof fromBookAgain,
      preselection: typeof bookAgain
    ) =>
      openingMeetingRoomDraft({
        kept: Option.some(kept),
        preselection,
        offerings,
        bookableDates,
      });

    expect(opening(fromBookAgain, bookAgain)).toEqual(oneHour);
    // A restarted checkout returns without the params.
    expect(opening(fromBookAgain, Option.none())).toEqual(oneHour);
    expect(opening({ seed: "", draft: oneHour }, bookAgain).duration).toEqual(
      Option.some("hour:4")
    );
  });

  test("a preselection that changes only early setup opens on it", async () => {
    const { booking, offerings, bookableDates } = await setup();
    const kept = {
      seed: bookingPreselectionKey(bookAgain),
      draft: {
        date: Option.some(booking.dateIn(5)),
        duration: Option.some("hour:4" as const),
        startTime: Option.some("09:00"),
        earlySetup: true,
      },
    };
    const withoutEarlySetup = Option.map(bookAgain, (booked) => ({
      ...booked,
      earlySetup: false,
    }));

    expect(
      openingMeetingRoomDraft({
        kept: Option.some(kept),
        preselection: withoutEarlySetup,
        offerings,
        bookableDates,
      }).earlySetup
    ).toBe(false);
  });
});

describe("meetingRoomBookingModel", () => {
  test("waits for a start of the customer's choosing, then continues once its interval is read", async () => {
    const {
      registry,
      offerings,
      calendar,
      oneHour,
      draft,
      startTimes,
      bookableDates,
    } = await setup();
    const unchosen = meetingRoomBookingModel({
      draft: oneHour,
      settled: oneHour,
      now,
      offerings,
      bookableDates,
      startTimes: Option.some(startTimes),
      calendar: Option.some(calendar),
      availability: Option.none(),
    });
    expect(unchosen.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "StartRequired",
    ]);
    expect(unchosen.quotable).toEqual(Option.none());

    const query = Option.getOrThrow(
      meetingRoomQueryOf(draft, Option.some(startTimes), now)
    );
    const availability = await settledValue(
      registry,
      bookingAvailabilityAtom({ query })
    );
    const model = meetingRoomBookingModel({
      draft,
      settled: draft,
      now,
      offerings,
      bookableDates,
      startTimes: Option.some(startTimes),
      calendar: Option.some(calendar),
      availability: Option.some({ query, value: availability }),
    });

    expect(model.enablement.blockers).toEqual([]);
    expect(Option.isSome(model.selection)).toBe(true);
    expect(model.quotable).toEqual(model.selection);
  });

  test("strikes through the calendar's days with no free start", async () => {
    const { booking, offerings, calendar, bookableDates } = await setup();

    const model = meetingRoomBookingModel({
      draft: emptyMeetingRoomDraft,
      settled: emptyMeetingRoomDraft,
      now,
      offerings,
      bookableDates,
      startTimes: Option.none(),
      calendar: Option.some(calendar),
      availability: Option.none(),
    });

    expect([...model.enablement.dates.unavailable]).toEqual(
      booking.unavailableDates
    );
  });

  test("availability read for an earlier draft doesn't answer a changed one", async () => {
    const { registry, offerings, calendar, draft, startTimes, bookableDates } =
      await setup();
    const query = Option.getOrThrow(
      meetingRoomQueryOf(draft, Option.some(startTimes), now)
    );
    const availability = await settledValue(
      registry,
      bookingAvailabilityAtom({ query })
    );
    const later = startTimes.startTimes[1]?.startDateTime.slice(11, 16) ?? "";

    const model = meetingRoomBookingModel({
      draft: selectMeetingRoomStartTime(draft, later),
      settled: draft,
      now,
      offerings,
      bookableDates,
      startTimes: Option.some(startTimes),
      calendar: Option.some(calendar),
      availability: Option.some({ query, value: availability }),
    });

    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
    // Not quoted until the new start has settled for the debounce.
    expect(model.quotable).toEqual(Option.none());
  });

  test("starts read for another date leave the draft waiting", async () => {
    const { booking, offerings, draft, startTimes, bookableDates } =
      await setup();
    const moved: MeetingRoomDraft = selectMeetingRoomDate(
      draft,
      booking.dateIn(4)
    );

    const model = meetingRoomBookingModel({
      draft: moved,
      settled: draft,
      now,
      offerings,
      bookableDates,
      startTimes: Option.some(startTimes),
      calendar: Option.none(),
      availability: Option.none(),
    });

    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
    expect(model.enablement.startChoices).toEqual(Option.none());
    expect(model.quotable).toEqual(Option.none());
  });
});
