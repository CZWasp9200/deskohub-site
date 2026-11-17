import { describe, expect, test } from "bun:test";
import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { productLabel } from "../checkout-screen/checkout-copy";
import { type PriceLine, priceBreakdown } from "./price-breakdown";
import {
  describeOfficePriceLine,
  describePriceLine,
  monitorOptionName,
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
          detail: m.booking_price_line_one_day({}, { locale }),
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

  test("names the workstation once, with its monitor setup under it", () => {
    const lines = described(reservedDeskWithWorkstation);
    expect(lines.map(([key]) => key)).toEqual([
      "product:cowork:reserved-desk",
      "product:cowork:reserved-desk:discount:calendar-sale-2026-11",
      "addon:workstation",
    ]);
    const lineMap = new Map(lines);
    expect(lineMap.get("product:cowork:reserved-desk")?.label).toBe(
      productLabel(reservedDeskWithWorkstation.selection, locale)
    );
    expect(lineMap.get("addon:workstation")).toEqual({
      label: m.booking_checkout_line_workstation({}, { locale }),
      detail: monitorOptionName("2x27-qhd"),
    });
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
          detail: m.booking_checkout_summary_office_days(
            { count: 3 },
            { locale }
          ),
        },
      ],
      [
        "product:office:6:3:seats",
        {
          label: m.booking_checkout_summary_office_seats(
            { count: 6 },
            { locale }
          ),
          detail: m.booking_checkout_summary_office_days(
            { count: 3 },
            { locale }
          ),
        },
      ],
      [
        "product:office:6:3:discount:office-week-10",
        { label: "Office discount" },
      ],
    ]);
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
