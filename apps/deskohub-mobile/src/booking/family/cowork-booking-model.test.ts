import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import { bookingPreselectionKey } from "../booking-preselection";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
} from "../data/booking-queries";
import {
  type CoworkDraft,
  coworkAvailabilityQueries,
  defaultCoworkDraft,
  selectCoworkDate,
  selectCoworkTier,
} from "../selection/cowork-selection";
import { pragueToday } from "../selection/prague-date";
import { fakeBooking } from "../testing/fake-booking-api";
import { checkoutRequestOf } from "./booking-family-view";
import { coworkBookingModel, openingCoworkDraft } from "./cowork-booking-model";
import { settledValue } from "./testing/settled-value";

const now = new Date();

/** The model once every availability read of the draft has settled. */
const settledModel = async (
  registry: AtomRegistry.AtomRegistry,
  draft: CoworkDraft
) => {
  const catalog = await settledValue(registry, bookingOfferingsAtom("en-US"));
  const queries = coworkAvailabilityQueries(draft, pragueToday(now));
  const read = (query: (typeof queries)["range"]) =>
    settledValue(registry, bookingAvailabilityAtom({ query }));
  const availability = {
    range: Option.some(await read(queries.range)),
    selection: Option.isSome(queries.selection)
      ? Option.some(await read(queries.selection.value))
      : Option.none(),
    workstationRequirement: Option.isSome(queries.workstationRequirement)
      ? Option.some(await read(queries.workstationRequirement.value))
      : Option.none(),
  };
  return coworkBookingModel({
    draft,
    now,
    offerings: catalog.offerings,
    availability,
  });
};

const setup = async () => {
  const data = makeFakeCustomerData("linked");
  const booking = fakeBooking(data.workspace);
  const catalog = await settledValue(
    data.registry,
    bookingOfferingsAtom("en-US")
  );
  // Tomorrow, so the same-day Open Space cutoff never applies.
  const draft = selectCoworkDate(
    defaultCoworkDraft(catalog.offerings),
    booking.dateIn(1)
  );
  return { ...data, booking, draft };
};

describe("coworkBookingModel", () => {
  test("an available day continues to checkout with its quote", async () => {
    const { registry, draft } = await setup();

    const model = await settledModel(registry, draft);
    const quote = await settledValue(
      registry,
      bookingQuoteAtom(Option.getOrThrow(model.quotable), "en-US")
    );

    expect(model.enablement.blockers).toEqual([]);
    expect(
      checkoutRequestOf({
        locale: "en-US",
        selection: model.selection,
        blockers: model.enablement.blockers,
        quote: Option.some(quote),
      })
    ).toEqual(
      Option.some({
        locale: "en-US",
        selection: Option.getOrThrow(model.selection),
        advertisedPriceToken: quote.advertisedPriceToken,
        quote: { summary: quote.summary, regularPrice: quote.regularPrice },
      })
    );
  });

  test("a day nothing can be booked on is shown taken and isn't quoted", async () => {
    const { registry, booking, draft } = await setup();
    const taken = booking.unavailableDates[0] ?? "";

    const model = await settledModel(registry, selectCoworkDate(draft, taken));

    expect(model.enablement.dates.unavailable.has(taken)).toBe(true);
    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toContain(
      "OfferUnavailable"
    );
    expect(model.quotable).toEqual(Option.none());
  });

  test("a Reserved Desk day without bare desks gets a free workstation, then reads its availability", async () => {
    const { registry, booking, draft } = await setup();
    const reservedDesk = {
      ...selectCoworkTier(draft, "reserved-desk"),
      date: Option.some(booking.workstationRequiredDates[0] ?? ""),
    };

    const fitted = await settledModel(registry, reservedDesk);

    expect(Option.getOrThrow(fitted.draft.workstation).origin).toBe(
      "requirement"
    );
    // The fitted selection's own availability hasn't been read yet.
    expect(fitted.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);

    const settled = await settledModel(registry, fitted.draft);

    expect(settled.draft).toBe(fitted.draft);
    expect(settled.enablement.blockers).toEqual([]);
    expect(Option.getOrThrow(settled.selection).monitorOption).toBe(
      Option.getOrThrow(fitted.draft.workstation).option
    );
  });

  test("a draft without a date asks for one and isn't quoted", async () => {
    const { registry } = await setup();
    const catalog = await settledValue(registry, bookingOfferingsAtom("en-US"));
    const draft = defaultCoworkDraft(catalog.offerings);

    const model = await settledModel(registry, draft);

    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "DateRequired",
    ]);
    expect(model.selection).toEqual(Option.none());
    expect(model.quotable).toEqual(Option.none());
  });

  test("waits for availability before continuing", async () => {
    const { registry, draft } = await setup();
    const catalog = await settledValue(registry, bookingOfferingsAtom("en-US"));

    const model = coworkBookingModel({
      draft,
      now,
      offerings: catalog.offerings,
      availability: {
        range: Option.none(),
        selection: Option.none(),
        workstationRequirement: Option.none(),
      },
    });

    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
    expect(model.quotable).toEqual(model.selection);
  });
});

describe("openingCoworkDraft", () => {
  const opening = async () => {
    const { registry, booking } = await setup();
    const { offerings } = await settledValue(
      registry,
      bookingOfferingsAtom("en-US")
    );
    const today = booking.today();
    const booked = {
      selection: {
        family: "cowork" as const,
        date: booking.dateIn(2),
        tier: "reserved-desk" as const,
        monitorOption: "2x27-4k" as const,
      },
    };
    return { offerings, today, booked };
  };

  test("opens empty without a preselection", async () => {
    const { offerings, today } = await opening();

    expect(
      openingCoworkDraft({
        kept: Option.none(),
        preselection: Option.none(),
        offerings,
        today,
      })
    ).toEqual(defaultCoworkDraft(offerings));
  });

  test("opens on a preselection's tier, day and workstation", async () => {
    const { offerings, today, booked } = await opening();

    const draft = openingCoworkDraft({
      kept: Option.none(),
      preselection: Option.some(booked),
      offerings,
      today,
    });

    expect(draft.tier).toBe("reserved-desk");
    expect(draft.date).toEqual(Option.some(booked.selection.date));
    expect(Option.map(draft.workstation, ({ option }) => option)).toEqual(
      Option.some("2x27-4k")
    );
  });

  test("a new preselection replaces the kept draft; none keeps it", async () => {
    const { offerings, today, booked } = await opening();
    const earlier = selectCoworkDate(
      defaultCoworkDraft(offerings),
      booked.selection.date
    );
    const kept = Option.some({ seed: "", draft: earlier });

    expect(
      openingCoworkDraft({
        kept,
        preselection: Option.none(),
        offerings,
        today,
      })
    ).toBe(earlier);
    expect(
      openingCoworkDraft({
        kept,
        preselection: Option.some(booked),
        offerings,
        today,
      }).tier
    ).toBe("reserved-desk");
    expect(
      openingCoworkDraft({
        kept: Option.some({
          seed: bookingPreselectionKey(Option.some(booked)),
          draft: earlier,
        }),
        preselection: Option.some(booked),
        offerings,
        today,
      })
    ).toBe(earlier);
  });
});
