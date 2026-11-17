import { describe, expect, test } from "bun:test";
import type {
  CustomerBookingSelection,
  Money,
} from "@deskohub/workspace-customer-api";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { productLabel } from "../checkout-screen/checkout-copy";
import {
  type PriceLine,
  type PriceLineSubject,
  priceBreakdown,
} from "./price-breakdown";
import {
  describeOfficePriceLine,
  describePriceLine,
  type PriceLineDescription,
} from "./price-line-description";
import {
  meetingRoomHour,
  officeSixSeatsDiscounted,
  openSpaceWithCoffee,
  type PriceFixture,
  reservedDeskWithWorkstation,
} from "./testing/price-fixtures";

const locale: AppLocale = "en-US";

/** Each line's key with how it reads. */
const described = (
  { selection, summary }: PriceFixture,
  readAs: CustomerBookingSelection = selection
): ReadonlyArray<readonly [string, PriceLineDescription]> => {
  const describe = describePriceLine(readAs, locale);
  return priceBreakdown(summary).lines.map(
    (line: PriceLine) => [line.key, describe(line)] as const
  );
};

describe("describePriceLine", () => {
  test("names a cowork desk by its tier, for one day, and a discount by its own label", () => {
    expect(described(openSpaceWithCoffee)).toEqual([
      [
        "product:cowork:open-space",
        {
          label: productLabel(openSpaceWithCoffee.selection, locale),
          detail: m.booking_price_line_days({ count: 1 }, { locale }),
        },
      ],
      [
        "product:cowork:open-space:discount:calendar-sale-2026-11",
        { label: "Calendar discount" },
      ],
      [
        "addon:coffee",
        { label: m.booking_checkout_line_coffee({}, { locale }) },
      ],
    ]);
  });

  test("names a workstation and the chosen monitor setup", () => {
    const lines = new Map(described(reservedDeskWithWorkstation));
    expect(lines.get("product:cowork:reserved-desk")?.label).toBe(
      productLabel(reservedDeskWithWorkstation.selection, locale)
    );
    expect(lines.get("addon:workstation")).toEqual({
      label: m.booking_checkout_line_workstation({}, { locale }),
    });
    const monitor = lines.get("monitor:2x27-qhd");
    expect(monitor?.label).toBe(
      m.booking_checkout_line_workstation({}, { locale })
    );
    expect(monitor?.detail).toContain("27");
  });

  test("gives a meeting room's hours with their start and end", () => {
    const [product] = described(meetingRoomHour);
    expect(product?.[1]).toEqual({
      label: productLabel(meetingRoomHour.selection, locale),
      detail: m.booking_price_line_one_hour(
        { start: "14:00", end: "15:00" },
        { locale }
      ),
    });
    const fourHours = {
      ...meetingRoomHour.selection,
      duration: "hour:4",
    } as const;
    expect(described(meetingRoomHour, fourHours)[0]?.[1].detail).toBe(
      m.booking_price_line_four_hours(
        { start: "14:00", end: "18:00" },
        { locale }
      )
    );
    const wholeDay: CustomerBookingSelection = {
      family: "meeting-room",
      date: "2026-11-26",
      duration: "day:1",
    };
    expect(described(meetingRoomHour, wholeDay)[0]?.[1].detail).toBe(
      m.booking_checkout_overview_whole_day({}, { locale })
    );
  });

  test("gives an office's access by days and its seats by seats and days", () => {
    expect(described(officeSixSeatsDiscounted)).toEqual([
      [
        "product:office:6:3:access",
        {
          label: productLabel(officeSixSeatsDiscounted.selection, locale),
          detail: m.booking_price_line_days({ count: 3 }, { locale }),
        },
      ],
      [
        "product:office:6:3:seats",
        {
          label: m.booking_checkout_line_office_seats({}, { locale }),
          detail: [
            m.booking_price_line_seats({ count: 6 }, { locale }),
            m.booking_price_line_days({ count: 3 }, { locale }),
          ].join(" × "),
        },
      ],
      [
        "product:office:6:3:discount:office-week-10",
        { label: "Office discount" },
      ],
    ]);
  });

  test("multiplies an office's counts by the daily rate the quote gives", () => {
    const rate = (value: number): Money => ({
      value,
      exponent: 0,
      currency: "CZK",
    });
    const describe = describeOfficePriceLine(locale, "Private office");
    const charge = (subject: PriceLineSubject): PriceLine => ({
      _tag: "Charge",
      key: subject._tag,
      subject,
      amount: rate(0),
    });

    expect(
      describe(
        charge({ _tag: "OfficeAccess", dayCount: 3, dailyRate: rate(530) })
      ).detail
    ).toBe(
      [
        m.booking_price_line_days({ count: 3 }, { locale }),
        formatMoney(rate(530), locale),
      ].join(" × ")
    );
    expect(
      describe(
        charge({
          _tag: "OfficeSeats",
          seats: 6,
          dayCount: 3,
          dailySeatRate: rate(315),
        })
      ).detail
    ).toBe(
      [
        m.booking_price_line_seats({ count: 6 }, { locale }),
        m.booking_price_line_days({ count: 3 }, { locale }),
        formatMoney(rate(315), locale),
      ].join(" × ")
    );
  });

  test("names an office's lines before a selection the way it names them once quoted", () => {
    const quoted = describePriceLine(
      officeSixSeatsDiscounted.selection,
      locale,
      "Private office"
    );
    const unselected = describeOfficePriceLine(locale, "Private office");
    for (const line of priceBreakdown(officeSixSeatsDiscounted.summary).lines) {
      expect(unselected(line)).toEqual(quoted(line));
    }
  });

  test("names every line in every locale", () => {
    for (const fixture of [
      openSpaceWithCoffee,
      reservedDeskWithWorkstation,
      meetingRoomHour,
      officeSixSeatsDiscounted,
    ]) {
      for (const lineLocale of ["cs-CZ", "hi-IN"] as const) {
        const describe = describePriceLine(fixture.selection, lineLocale);
        for (const line of priceBreakdown(fixture.summary).lines) {
          expect(describe(line).label.trim()).not.toBe("");
        }
      }
    }
  });
});

describe("describePriceLine for an overnight stay", () => {
  test("reads the desk as a stay rather than one day", () => {
    const overnight = {
      ...reservedDeskWithWorkstation.selection,
      stay: "overnight",
    } as const;
    const detail = (selection: CustomerBookingSelection) =>
      new Map(described(reservedDeskWithWorkstation, selection)).get(
        "product:cowork:reserved-desk"
      )?.detail;

    expect(detail(overnight)).toBeString();
    expect(detail(overnight)).not.toBe(
      detail(reservedDeskWithWorkstation.selection)
    );
  });
});

// One, few and many as Czech counts them (1, 2–4, 5 and up); English has
// one and other. Each plural form is a different text, and a count reads in
// the same form in an office's access and seats lines.
describe.each([
  ["cs-CZ", [1, 3, 5]],
  ["en-US", [1, 3]],
] as const)("an office's counts in %s", (countLocale, counts) => {
  const describe = describeOfficePriceLine(countLocale, "Private office");
  const detailFor = (subject: PriceLineSubject) =>
    describe({
      _tag: "Charge",
      key: subject._tag,
      subject,
      amount: { value: 0, exponent: 0, currency: "CZK" },
    }).detail;

  test("read each plural form differently", () => {
    const days = counts.map((count) =>
      detailFor({ _tag: "OfficeAccess", dayCount: count })?.replace(
        String(count),
        "#"
      )
    );
    const seats = counts.map((count) =>
      detailFor({ _tag: "OfficeSeats", seats: count, dayCount: 1 })
        ?.split(" × ")[0]
        ?.replace(String(count), "#")
    );
    expect(new Set(days).size).toBe(counts.length);
    expect(new Set(seats).size).toBe(counts.length);
  });

  test("read counts of the same form alike", () => {
    const sameForm = (first: number, second: number) =>
      [first, second].map((count) =>
        detailFor({ _tag: "OfficeAccess", dayCount: count })?.replace(
          String(count),
          "#"
        )
      );
    const [first, second] = sameForm(
      counts.at(-1) ?? 0,
      (counts.at(-1) ?? 0) + 1
    );
    expect(first).toBe(second);
  });
});
