import { describe, expect, test } from "bun:test";
import { m } from "../../i18n/messages";
import { productLabel } from "../checkout-screen/checkout-copy";
import { bookingSummaryOf, bookingSummaryParts } from "./booking-summary";
import { formatPragueTime, formatShortPragueDate } from "./prague-date-format";
import { monitorOptionName } from "./price-line-description";

const locale = "en-US" as const;
const parts = (detail: string) => detail.split(" · ");

describe("bookingSummaryOf", () => {
  test("names the product first, then each extra", () => {
    const openSpace = {
      family: "cowork",
      tier: "open-space",
      date: "2026-11-26",
      coffee: true,
    } as const;
    expect(parts(bookingSummaryOf(openSpace, locale).detail)).toEqual([
      productLabel(openSpace, locale),
      m.booking_summary_coffee({}, { locale }),
    ]);
    const desk = {
      family: "cowork",
      tier: "reserved-desk",
      date: "2026-11-26",
      monitorOption: "2x27-qhd",
    } as const;
    expect(parts(bookingSummaryOf(desk, locale).detail)).toEqual([
      productLabel(desk, locale),
      monitorOptionName("2x27-qhd"),
    ]);
  });

  test("an Open Space day and a Reserved Desk day say different hours", () => {
    const day = (tier: "open-space" | "reserved-desk") =>
      bookingSummaryOf({ family: "cowork", tier, date: "2026-11-26" }, locale)
        .title;
    expect(day("open-space")).not.toBe(day("reserved-desk"));
  });

  test("an office over several days names both ends; one day names one", () => {
    const office = (endDate: string) =>
      bookingSummaryOf(
        { family: "office", date: "2026-11-23", endDate, seats: 6 },
        locale
      ).title;
    expect(office("2026-11-25")).not.toBe(office("2026-11-23"));
    expect(office("2026-11-25").startsWith(office("2026-11-23"))).toBe(true);
  });

  test("a meeting room's hours and its whole day read differently", () => {
    const hours = bookingSummaryOf(
      {
        family: "meeting-room",
        date: "2026-11-18",
        startTime: "14:00",
        duration: "hour:1",
      },
      locale
    );
    const wholeDay = bookingSummaryOf(
      { family: "meeting-room", date: "2026-11-18", duration: "day:1" },
      locale
    );
    expect(parts(hours.detail)).toHaveLength(2);
    expect(parts(wholeDay.detail)).toHaveLength(1);
    expect(hours.title).not.toBe(wholeDay.title);
  });

  test("an overnight Reserved Desk names its arrival and the next day", () => {
    const desk = {
      family: "cowork",
      tier: "reserved-desk",
      date: "2026-11-16",
    } as const;
    const overnightStay = { startTime: "13:00", endTime: "11:30" };
    const overnight = bookingSummaryOf({ ...desk, stay: "overnight" }, locale, {
      overnightStay,
    }).title;

    expect(overnight).not.toBe(bookingSummaryOf(desk, locale).title);
    // Arrival date and start, then departure date and end, in that order.
    const positions = [
      formatShortPragueDate("2026-11-16", locale),
      formatPragueTime("13:00", locale),
      formatShortPragueDate("2026-11-17", locale),
      formatPragueTime("11:30", locale),
    ].map((part) => overnight.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(bookingSummaryOf(desk, locale, { overnightStay }).title).toBe(
      bookingSummaryOf(desk, locale).title
    );
  });
});

describe("bookingSummaryParts", () => {
  test("an overnight Reserved Desk's review card names arrival and departure", () => {
    const overnightDesk = {
      family: "cowork",
      tier: "reserved-desk",
      date: "2026-11-30",
      stay: "overnight",
      monitorOption: "2x27-qhd",
    } as const;
    const overnightStay = { startTime: "12:00", endTime: "12:00" };
    const { title, extras } = bookingSummaryParts(
      overnightDesk,
      locale,
      overnightStay
    );

    expect(title).not.toBe(
      bookingSummaryParts({ ...overnightDesk, stay: "day" }, locale).title
    );
    // Arrival on the reserved date, departure on the next, both at noon.
    const positions = [
      formatShortPragueDate("2026-11-30", locale),
      formatPragueTime("12:00", locale),
      formatShortPragueDate("2026-12-01", locale),
    ].map((part) => title.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(
      title.lastIndexOf(formatPragueTime("12:00", locale))
    ).toBeGreaterThan(positions[2] ?? -1);
    expect(extras).toEqual([monitorOptionName("2x27-qhd")]);
    expect(
      bookingSummaryOf(overnightDesk, locale, { overnightStay }).title
    ).toBe(title);
  });
});
