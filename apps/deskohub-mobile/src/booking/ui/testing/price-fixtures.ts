import type {
  CustomerBookingSelection,
  CustomerCheckoutSummary,
  CustomerCheckoutSummaryDiscount,
  CustomerCheckoutSummaryItem,
  Money,
} from "@deskohub/workspace-customer-api";
import { czk } from "../../testing/sample-booking-catalog";

/**
 * Synthetic pricing responses for tests and the booking gallery, shaped as
 * the Workspace's summary builders make them
 * (`apps/deskohub-workspace/features/checkout/checkout-summary-*.ts`): an
 * order section whose discounted product line carries its price before
 * discounts and each discount, then a total section with the final total.
 * Prices and discounts are made up.
 */
export interface PriceFixture {
  readonly selection: CustomerBookingSelection;
  readonly summary: CustomerCheckoutSummary;
}

const calendarDiscount = (crowns: number): CustomerCheckoutSummaryDiscount => ({
  discount: { id: "calendar-sale-2026-11", label: "Calendar discount" },
  amount: czk(crowns),
});

const summaryOf = (
  items: ReadonlyArray<CustomerCheckoutSummaryItem>,
  total: Money
): CustomerCheckoutSummary => ({
  sections: [
    { key: "order", items, total },
    { key: "total", items: [{ key: "total:final", amount: total }], total },
  ],
  total,
  vatStatus: "not-vat-payer",
});

/** Open Space for a day with a 20% calendar discount on the desk, plus coffee: 290 − 58 + 50 = 282. */
export const openSpaceWithCoffee: PriceFixture = {
  selection: {
    family: "cowork",
    date: "2026-11-26",
    tier: "open-space",
    coffee: true,
  },
  summary: summaryOf(
    [
      {
        key: "product:cowork:open-space",
        amount: czk(232),
        originalAmount: czk(290),
        discounts: [calendarDiscount(58)],
      },
      { key: "addon:coffee", amount: czk(50) },
    ],
    czk(282)
  ),
};

/**
 * A Reserved Desk with a calendar discount and a monitor workstation; the
 * monitor setup is the builder's zero-priced line: 410 − 82 + 120 = 448.
 */
export const reservedDeskWithWorkstation: PriceFixture = {
  selection: {
    family: "cowork",
    date: "2026-11-26",
    tier: "reserved-desk",
    monitorOption: "2x27-qhd",
  },
  summary: summaryOf(
    [
      {
        key: "product:cowork:reserved-desk",
        amount: czk(328),
        originalAmount: czk(410),
        discounts: [calendarDiscount(82)],
      },
      {
        key: "addon:workstation",
        amount: czk(120),
        monitorOption: "2x27-qhd",
      },
    ],
    czk(448)
  ),
};

/** The meeting room for an hour from 14:00 with a calendar discount: 350 − 70 = 280. */
export const meetingRoomHour: PriceFixture = {
  selection: {
    family: "meeting-room",
    date: "2026-11-26",
    startTime: "14:00",
    duration: "hour:1",
  },
  summary: summaryOf(
    [
      {
        key: "product:meeting-room:hour:1",
        amount: czk(280),
        originalAmount: czk(350),
        discounts: [calendarDiscount(70)],
      },
    ],
    czk(280)
  ),
};

const officeSelection: CustomerBookingSelection = {
  family: "office",
  date: "2026-11-23",
  endDate: "2026-11-25",
  seats: 6,
};

/**
 * The office line's parts: access for 3 days, one seat for 3 days, and the 6
 * seats for 3 days.
 */
const officeParts = {
  key: "product:office:6:3",
  dayCount: 3,
  seats: 6,
  accessAmount: czk(1590),
  seatAmount: czk(945),
  seatsAmount: czk(5670),
} as const;

/** A private office for 3 days with 6 seats: 1,590 + 6 × 945 = 7,260. */
export const officeSixSeats: PriceFixture = {
  selection: officeSelection,
  summary: summaryOf([{ ...officeParts, amount: czk(7260) }], czk(7260)),
};

/** The same office with a 10% discount on the whole price: 7,260 − 726 = 6,534. */
export const officeSixSeatsDiscounted: PriceFixture = {
  selection: officeSelection,
  summary: summaryOf(
    [
      {
        ...officeParts,
        amount: czk(6534),
        originalAmount: czk(7260),
        discounts: [
          {
            discount: { id: "office-week-10", label: "Office discount" },
            amount: czk(726),
          },
        ],
      },
    ],
    czk(6534)
  ),
};

/** Every fixture by name. */
export const priceFixtures = {
  openSpaceWithCoffee,
  reservedDeskWithWorkstation,
  meetingRoomHour,
  officeSixSeats,
  officeSixSeatsDiscounted,
} as const satisfies Record<string, PriceFixture>;
