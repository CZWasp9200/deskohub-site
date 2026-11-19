import { describe, expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import { formatInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { historyBadgeKind, shortDate } from "./booking-ticket-text";
import { dateTileParts } from "./booking-time";
import {
  nextReservationView,
  type ReservationListRow,
  reservationGroups,
  reservationRowView,
  reservationStatusTarget,
} from "./reservation-list-model";

const now = DateTime.makeUnsafe("2026-11-08T12:00:00Z");
const row = (
  id: string,
  change: Partial<ReservationListRow> = {}
): ReservationListRow => ({
  id,
  product: { kind: "meeting-room" },
  startsAt: "2026-11-08T09:00:00Z",
  endsAt: "2026-11-08T17:00:00Z",
  seats: 2,
  status: "confirmed",
  ...change,
});
const ids = (rows: ReadonlyArray<ReservationListRow>) => rows.map((r) => r.id);

describe("reservationGroups", () => {
  test("features the first current reservation and lists the others", () => {
    const groups = reservationGroups(
      {
        current: [row("a"), row("b"), row("c")],
        past: [row("p", { endsAt: "2026-11-01T10:00:00Z" })],
        unavailable: [row("u", { startsAt: null, endsAt: null })],
      },
      now
    );

    expect(Option.map(groups.featured, (r) => r.id)).toEqual(Option.some("a"));
    expect(ids(groups.moreCurrent)).toEqual(["b", "c"]);
    expect(ids(groups.past)).toEqual(["p"]);
    expect(ids(groups.undated)).toEqual(["u"]);
    expect(groups.empty).toBe(false);
  });

  test("moves a current reservation that has ended to the top of past", () => {
    const groups = reservationGroups(
      {
        current: [
          row("ended", { endsAt: "2026-11-08T11:00:00Z" }),
          row("ends-now", { endsAt: "2026-11-08T12:00:00Z" }),
          row("running"),
        ],
        past: [row("older", { endsAt: "2026-11-01T10:00:00Z" })],
        unavailable: [],
      },
      now
    );

    expect(Option.map(groups.featured, (r) => r.id)).toEqual(
      Option.some("running")
    );
    expect(groups.moreCurrent).toEqual([]);
    expect(ids(groups.past)).toEqual(["ended", "ends-now", "older"]);
  });

  test("is empty only without any reservation", () => {
    expect(
      reservationGroups({ current: [], past: [], unavailable: [] }, now).empty
    ).toBe(true);
    expect(
      reservationGroups({ current: [], past: [], unavailable: [row("u")] }, now)
        .empty
    ).toBe(false);
  });
});

describe("reservationRowView", () => {
  test("a past booking says only that it was cancelled, else its time", () => {
    const cancelled = reservationRowView(
      row("c", { status: "cancelled" }),
      "past",
      "en-US"
    );
    const done = reservationRowView(row("d"), "past", "en-US");
    expect(cancelled.detail).toBe(
      m.reservationStatusCancelled({}, { locale: "en-US" })
    );
    expect(done.detail).not.toBe(cancelled.detail);
    expect(Option.isNone(cancelled.badge)).toBe(true);
    expect(Option.isNone(done.badge)).toBe(true);
  });

  test("a later booking not confirmed yet carries its badge", () => {
    expect(
      reservationRowView(
        row("a", { status: "requires-attention" }),
        "later",
        "en-US"
      ).badge
    ).toEqual(Option.some("attention"));
    expect(
      reservationRowView(row("p", { status: "pending" }), "later", "en-US")
        .badge
    ).toEqual(Option.some("pending"));
    expect(
      Option.isNone(reservationRowView(row("c"), "later", "en-US").badge)
    ).toBe(true);
  });

  test("an overnight stay keeps its times and an office shows its dates and seats", () => {
    // An overnight stay: noon to noon in Prague (UTC+1).
    const overnight = reservationRowView(
      row("o", {
        product: { kind: "cowork", tier: "reserved-desk" },
        startsAt: "2026-11-17T11:00:00Z",
        endsAt: "2026-11-18T11:00:00Z",
      }),
      "later",
      "en-US"
    );
    // Whole days end at the next midnight, which isn't a day of the booking.
    const days = reservationRowView(
      row("d", {
        product: { kind: "office" },
        startsAt: "2026-11-16T23:00:00Z",
        endsAt: "2026-11-18T23:00:00Z",
        seats: 6,
      }),
      "later",
      "en-US"
    );
    const start = DateTime.makeUnsafe("2026-11-17T11:00:00Z");
    const end = DateTime.makeUnsafe("2026-11-18T11:00:00Z");
    expect(overnight.detail).toBe(
      m.reservations_time_range(
        {
          start: formatInstant(start, "en-US", "time"),
          end: m.reservations_date_time(
            {
              date: shortDate(end, "en-US"),
              time: formatInstant(end, "en-US", "time"),
            },
            { locale: "en-US" }
          ),
        },
        { locale: "en-US" }
      )
    );
    expect(days.detail).toBe(
      [
        m.reservations_time_range(
          { start: "Nov 17", end: "Nov 18" },
          { locale: "en-US" }
        ),
        m.reservations_seats({ count: 6 }, { locale: "en-US" }),
      ].join(" · ")
    );
  });

  test("an unreadable time has no tile and reads as unavailable", () => {
    const view = reservationRowView(
      row("x", { startsAt: null }),
      "later",
      "en-US"
    );
    expect(Option.isNone(view.date)).toBe(true);
    expect(view.detail).toBe(
      m.reservations_value_unavailable({}, { locale: "en-US" })
    );
  });
});

describe("nextReservationView", () => {
  const access = {
    code: "5129083",
    accessStartsAt: "2026-11-08T08:00:00Z",
    accessEndsAt: "2026-11-08T17:00:00Z",
  };

  test("shows today's PIN when the list carries it", () => {
    const view = nextReservationView(
      row("t", { todayAccess: access }),
      now,
      "en-US"
    );
    expect(view.access).toMatchObject({ _tag: "Pin", code: access.code });
    expect(view.countdown).toEqual(Option.some({ kind: "open-now" }));
  });

  test("a confirmed booking without today's PIN points to it", () => {
    const view = nextReservationView(
      row("r", {
        startsAt: "2026-11-26T08:00:00Z",
        endsAt: "2026-11-26T16:00:00Z",
        accessStartsAt: "2026-11-25T23:00:00Z",
      }),
      now,
      "en-US"
    );
    expect(view.access._tag).toBe("Ready");
    expect(
      view.access._tag === "Ready" && Option.isSome(view.access.from)
    ).toBe(true);
  });

  test("a booking not confirmed yet waits for payment, whatever it carries", () => {
    for (const status of ["pending", "requires-attention"] as const) {
      expect(
        nextReservationView(
          row("p", { status, todayAccess: access }),
          now,
          "en-US"
        ).access
      ).toEqual({ _tag: "AfterPayment" });
    }
  });
});

describe("a failed order", () => {
  // The history answers a hold whose payment ended unpaid as cancelled, at
  // its booked time, whether that time is still ahead or not.
  test("lists as not booked on its booked day and opens its ticket", () => {
    const orderId = "order-failed" as ReservationListRow["orderId"];
    const failed = row("failed", {
      orderId,
      status: "cancelled",
      startsAt: "2026-11-14T09:00:00Z",
      endsAt: "2026-11-14T11:00:00Z",
    });

    const groups = reservationGroups(
      { current: [row("next")], past: [failed], unavailable: [] },
      now
    );
    const view = reservationRowView(failed, "past", "en-US");

    expect(ids(groups.past)).toEqual(["failed"]);
    expect(historyBadgeKind(failed.status)).toBe("not-booked");
    expect(view.date).toEqual(
      Option.some(
        dateTileParts(DateTime.makeUnsafe("2026-11-14T09:00:00Z"), "en-US")
      )
    );
    expect(view.detail).not.toBe(
      m.reservations_value_unavailable({}, { locale: "en-US" })
    );
    expect(reservationStatusTarget(failed)).toEqual(
      Option.fromNullishOr(orderId)
    );
  });
});

describe("reservationStatusTarget", () => {
  test("opens the status of a row with an order, and none without", () => {
    const orderId = "order-1" as ReservationListRow["orderId"];
    expect(reservationStatusTarget(row("x", { orderId }))).toEqual(
      Option.fromNullishOr(orderId)
    );
    expect(Option.isNone(reservationStatusTarget(row("y")))).toBe(true);
  });
});
