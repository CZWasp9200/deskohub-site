import { describe, expect, test } from "bun:test";
import type { CustomerBookedSelection } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import { bookingPreselectionKey } from "../booking-preselection";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
} from "../data/booking-queries";
import { youOnly } from "../selection/office-people";
import {
  emptyOfficeDraft,
  type OfficeDraft,
  type OfficeOffering,
  officeAvailabilityQuery,
  selectOfficeDate,
} from "../selection/office-selection";
import { fakeBooking } from "../testing/fake-booking-api";
import { officePeopleOf } from "../testing/office-people-fixtures";
import { czk } from "../testing/sample-booking-catalog";
import { priceLineAmount } from "../ui/price-breakdown";
import {
  officeBookingModel,
  officeFromPrice,
  officeOfferingOf,
  openingOfficeDraft,
} from "./office-booking-model";
import { settledValue } from "./testing/settled-value";

const setup = async () => {
  const data = makeFakeCustomerData("linked");
  const booking = fakeBooking(data.workspace);
  const catalog = await settledValue(
    data.registry,
    bookingOfferingsAtom("en-US")
  );
  const offering = Option.getOrThrow(officeOfferingOf(catalog.offerings));
  const availability = await settledValue(
    data.registry,
    bookingAvailabilityAtom({
      query: officeAvailabilityQuery(offering.bookableDates),
    })
  );
  const model = (draft: OfficeDraft, office: OfficeOffering = offering) =>
    officeBookingModel({
      draft,
      offering: office,
      availability: Option.some(availability),
    });
  return { booking, offering, model };
};

describe("officeBookingModel", () => {
  test("before a first day nothing is quoted and no steppers show", async () => {
    const { model } = await setup();

    const office = model(emptyOfficeDraft);

    expect(office.selection).toEqual(Option.none());
    expect(office.quotable).toEqual(Option.none());
    expect(office.steppers).toEqual(Option.none());
    expect(office.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "DateRequired",
    ]);
  });

  test("a free day with one seat continues", async () => {
    const { booking, model } = await setup();

    const office = model(selectOfficeDate(emptyOfficeDraft, booking.dateIn(1)));

    expect(office.enablement.blockers).toEqual([]);
    expect(office.quotable).toEqual(office.selection);
    expect(Option.isSome(office.selection)).toBe(true);
  });

  test("days are kept within what the first day allows", async () => {
    const { booking, model } = await setup();
    // The fake's first unavailable date is three days ahead.
    const office = model({
      date: Option.some(booking.dateIn(1)),
      dayCount: 30,
      people: youOnly,
    });

    expect(office.draft.dayCount).toBe(office.enablement.maximumDayCount);
    expect(office.enablement.maximumDayCount).toBe(2);
    expect(office.enablement.blockers).toEqual([]);
  });

  test("sends one seat per person, and blocks more people than seats", async () => {
    const { booking, offering, model } = await setup();
    const most = offering.maximumSeats ?? 0;
    const withPeople = (count: number) =>
      model({
        date: Option.some(booking.dateIn(1)),
        dayCount: 1,
        people: officePeopleOf(count),
      });

    expect(Option.map(withPeople(2).selection, ({ seats }) => seats)).toEqual(
      Option.some(2)
    );
    expect(
      withPeople(most + 1).enablement.blockers.map(({ _tag }) => _tag)
    ).toEqual(["SeatsUnavailable"]);
    expect(withPeople(most + 1).draft.people.invitees).toHaveLength(most);
  });

  test("a taken first day can't continue, isn't quoted and shows no steppers", async () => {
    const { booking, model } = await setup();

    const office = model(
      selectOfficeDate(emptyOfficeDraft, booking.unavailableDates[0] ?? "")
    );

    expect(office.enablement.blockers.map(({ _tag }) => _tag)).toContain(
      "DateUnavailable"
    );
    expect(office.quotable).toEqual(Option.none());
    expect(office.steppers).toEqual(Option.none());
  });
});

describe("office steppers", () => {
  test("days go as far as the first day allows and name the stay's last day", async () => {
    const { booking, model } = await setup();

    const steppers = model({
      date: Option.some(booking.dateIn(1)),
      dayCount: 2,
      people: youOnly,
    }).steppers.pipe(Option.getOrThrow);

    expect(steppers.days).toEqual({
      maximum: 2,
      lastDate: booking.dateIn(2),
    });
  });

  test("people say how many of the office's seats they take, and when all are taken", async () => {
    const { booking, offering, model } = await setup();
    const most = offering.maximumSeats ?? 0;
    const peopleWith = (count: number) =>
      model({
        date: Option.some(booking.dateIn(1)),
        dayCount: 1,
        people: officePeopleOf(count),
      }).steppers.pipe(Option.getOrThrow).people;

    expect(most).toBeGreaterThan(1);
    expect(peopleWith(1)).toEqual({
      count: 1,
      maximum: Option.some(most),
      full: false,
    });
    expect(peopleWith(most).full).toBe(true);
    expect(peopleWith(most + 3).full).toBe(true);
  });

  test("people claim no limit while the capacity can't be read", async () => {
    const { booking, offering, model } = await setup();
    const { maximumSeats: _, ...withoutCapacity } = offering;

    const people = model(
      {
        date: Option.some(booking.dateIn(1)),
        dayCount: 1,
        people: officePeopleOf(9),
      },
      withoutCapacity
    ).steppers.pipe(Option.getOrThrow).people;

    expect(people).toEqual({ count: 9, maximum: Option.none(), full: false });
  });
});

describe("openingOfficeDraft", () => {
  const bookableDates = { earliest: "2026-11-10", latest: "2026-12-10" };
  const preselection = (
    seats: number
  ): Option.Option<CustomerBookedSelection> =>
    Option.some({
      selection: {
        family: "office",
        date: "2026-11-23",
        endDate: "2026-11-25",
        seats,
      },
    });
  const keptDraft: OfficeDraft = {
    date: Option.some("2026-11-12"),
    dayCount: 1,
    people: officePeopleOf(2),
  };

  test("opens empty without a preselection or a kept draft", () => {
    expect(
      openingOfficeDraft({
        kept: Option.none(),
        preselection: Option.none(),
        bookableDates,
      })
    ).toEqual(emptyOfficeDraft);
  });

  test("opens a preselection's stay with You only on the list", () => {
    expect(
      openingOfficeDraft({
        kept: Option.none(),
        preselection: preselection(6),
        bookableDates,
      })
    ).toEqual({
      date: Option.some("2026-11-23"),
      dayCount: 3,
      people: youOnly,
    });
  });

  test("keeps the customer's draft when no other preselection opened the screen", () => {
    const kept = (seed: string) => Option.some({ seed, draft: keptDraft });

    expect(
      openingOfficeDraft({
        kept: kept(""),
        preselection: Option.none(),
        bookableDates,
      })
    ).toBe(keptDraft);
    expect(
      openingOfficeDraft({
        kept: kept(bookingPreselectionKey(preselection(6))),
        preselection: preselection(6),
        bookableDates,
      })
    ).toBe(keptDraft);
    expect(
      openingOfficeDraft({
        kept: kept(bookingPreselectionKey(preselection(6))),
        preselection: preselection(4),
        bookableDates,
      }).people
    ).toEqual(youOnly);
  });
});

describe("officeFromPrice", () => {
  const offering: OfficeOffering = {
    family: "office",
    name: "Office",
    description: "",
    usage: "",
    price: czk(530),
    seatPrice: czk(315),
    maximumSeats: 6,
    maximumDurationHours: 672,
    advertisedPrice: { price: czk(845), discount: czk(0) },
    bookableDates: { earliest: "2026-11-10", latest: "2026-12-10" },
  };

  test("itemizes a day's access and one seat, totalling the advertised price", () => {
    expect(officeFromPrice(offering)).toEqual(
      Option.some({
        lines: [
          {
            _tag: "Charge",
            key: "office:access",
            subject: { _tag: "OfficeAccess", dayCount: 1 },
            amount: offering.price,
          },
          {
            _tag: "Charge",
            key: "office:seat",
            subject: {
              _tag: "OfficeSeats",
              seats: 1,
              dayCount: 1,
              dailySeatRate: offering.seatPrice,
            },
            amount: offering.seatPrice,
          },
        ],
        total: offering.advertisedPrice.price,
        vatStatus: "not-vat-payer",
      })
    );
  });

  const sale = {
    discount: {
      id: "calendar-sale-2026-11",
      label: "Calendar discount",
      adjustment: { kind: "percentage", basisPoints: 1000 },
    },
    amount: czk(84.5),
  } as const;
  const onSale: OfficeOffering = {
    ...offering,
    advertisedPrice: {
      price: czk(760.5),
      discount: czk(84.5),
      discounts: [sale],
    },
  };

  test("during a sale, lists the base lines, then the sale as one discount line", () => {
    const lines = Option.getOrThrow(officeFromPrice(onSale)).lines;
    expect(lines.map((line) => line._tag)).toEqual([
      "Charge",
      "Charge",
      "Reduction",
    ]);
    expect(lines.at(-1)).toMatchObject({
      _tag: "Reduction",
      discountId: sale.discount.id,
      label: sale.discount.label,
      adjustment: sale.discount.adjustment,
      amount: sale.amount,
    });
  });

  test("during a sale, its lines add up to the advertised price", () => {
    const breakdown = Option.getOrThrow(officeFromPrice(onSale));
    expect(
      breakdown.lines.reduce(
        (sum, line) => sum + priceLineAmount(line).value,
        0
      )
    ).toBe(breakdown.total.value);
    expect(breakdown.total).toEqual(onSale.advertisedPrice.price);
  });

  test("gives no lines while a sale's discounts are not listed", () => {
    expect(
      officeFromPrice({
        ...offering,
        advertisedPrice: { price: czk(760), discount: czk(85) },
      })
    ).toEqual(Option.none());
  });

  test("gives no lines when the listed discounts don't make up the sale", () => {
    expect(
      officeFromPrice({
        ...onSale,
        advertisedPrice: { ...onSale.advertisedPrice, discount: czk(90) },
      })
    ).toEqual(Option.none());
  });
});
