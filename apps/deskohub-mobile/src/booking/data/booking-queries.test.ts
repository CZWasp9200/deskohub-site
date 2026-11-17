import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  type CustomerBookingSelection,
  CustomerBookingSelectionInvalid,
} from "@deskohub/workspace-customer-api";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  AsyncResult,
  type Atom,
  type AtomRegistry,
} from "effect/unstable/reactivity";
import {
  AccountReadBudget,
  accountReadAllowance,
} from "../../customer-api/account-read-budget";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  makeCustomerDataRegistry,
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  type BookingEndpointName,
  fakeBooking,
} from "../testing/fake-booking-api";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
  catalogIdleTTL,
  legalDocumentsAtom,
  meetingRoomStartTimesAtom,
  offeringsRolloverRetryDelay,
  quoteRefreshInterval,
} from "./booking-queries";
import { toBookingQueryError } from "./booking-query-error";

const remainingReadsAtom = customerDataRuntime.atom(
  Effect.flatMap(
    Effect.service(AccountReadBudget),
    (budget) => budget.remaining
  )
);

/** Runs `effect` on the registry's data runtime. */
const inRuntime = <A>(
  registry: AtomRegistry.AtomRegistry,
  effect: Effect.Effect<A, never, AccountReadBudget>
) =>
  Effect.runPromise(
    Effect.provideContext(
      effect,
      AsyncResult.getOrThrow(registry.get(customerDataRuntime))
    )
  );

/** Spends `count` reads of the registry's account read budget. */
const spendReads = (registry: AtomRegistry.AtomRegistry, count: number) =>
  inRuntime(
    registry,
    Effect.flatMap(Effect.service(AccountReadBudget), (budget) =>
      Effect.repeat(budget.spend, { times: count - 1 })
    )
  );

/** A registry whose runtime runs on a test clock, with a way to move it. */
const withTestClock = () => {
  const workspace = FakeWorkspace.forKind("linked");
  const registry = makeCustomerDataRegistry(
    Layer.merge(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
      TestClock.layer()
    )
  );
  return {
    registry,
    workspace,
    booking: fakeBooking(workspace),
    adjust: (duration: Parameters<typeof TestClock.adjust>[0]) =>
      inRuntime(registry, TestClock.adjust(duration)),
  };
};

/** Lets the registry run what the clock woke before asserting. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

const coworkSelection = (date: string): CustomerBookingSelection => ({
  family: "cowork",
  tier: "open-space",
  date,
  coffee: true,
});

const quoteCalls = (registry: { booking: ReturnType<typeof fakeBooking> }) =>
  registry.booking.endpoints.filter((endpoint) => endpoint === "getQuote")
    .length;

const remainingReads = async (registry: AtomRegistry.AtomRegistry) => {
  const result = await settle(registry, remainingReadsAtom);
  return result._tag === "Success" ? result.success : Number.NaN;
};

interface CatalogRead {
  readonly name: string;
  readonly endpoint: BookingEndpointName;
  readonly idleTTL: Duration.Duration;
  readonly atom: (
    booking: ReturnType<typeof fakeBooking>
  ) => Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>;
}

const catalogReads: CatalogRead[] = [
  {
    name: "offerings",
    endpoint: "listOfferings",
    idleTTL: catalogIdleTTL.offerings,
    atom: () => bookingOfferingsAtom("en-US"),
  },
  {
    name: "availability",
    endpoint: "getAvailability",
    idleTTL: catalogIdleTTL.availability,
    atom: (booking) =>
      bookingAvailabilityAtom({
        query: { kind: "cowork", date: booking.dateIn(7) },
      }),
  },
  {
    name: "meeting-room start times",
    endpoint: "getMeetingRoomStartTimes",
    idleTTL: catalogIdleTTL.availability,
    atom: (booking) =>
      meetingRoomStartTimesAtom({
        date: booking.dateIn(1),
        duration: "hour:1",
      }),
  },
  {
    name: "quote",
    endpoint: "getQuote",
    idleTTL: catalogIdleTTL.quote,
    atom: (booking) =>
      bookingQuoteAtom(coworkSelection(booking.dateIn(20)), "en-US"),
  },
];

describe("booking catalog queries", () => {
  test("reads the offerings through the real client", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");

    const result = await settle(registry, bookingOfferingsAtom("en-US"));

    expect(result._tag === "Success" && result.success.offerings.length).toBe(
      6
    );
    expect(fakeBooking(workspace).endpoints).toEqual(["listOfferings"]);
  });

  test.each(catalogReads)(
    "reads the $name as a catalog read, without spending the account read budget",
    async ({ endpoint, atom }) => {
      const { registry, workspace } = makeFakeCustomerData("linked");
      const booking = fakeBooking(workspace);

      const result = await settle(registry, atom(booking));

      expect(result._tag).toBe("Success");
      expect(booking.endpoints).toEqual([endpoint]);
      expect(await remainingReads(registry)).toBe(accountReadAllowance.reads);
    }
  );

  test("reads the legal documents without spending the read budget", async () => {
    const { registry } = makeFakeCustomerData("linked");

    const result = await settle(registry, legalDocumentsAtom("cs-CZ"));

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        documents: [
          { key: "terms-and-conditions" },
          { key: "operating-rules" },
        ],
      },
    });
    expect(await remainingReads(registry)).toBe(accountReadAllowance.reads);
  });

  test("reads availability once per distinct query", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    const query = { kind: "cowork" as const, date: booking.dateIn(7) };

    const first = await settle(registry, bookingAvailabilityAtom({ query }));
    const unmount = registry.mount(bookingAvailabilityAtom({ query }));
    await settle(registry, bookingAvailabilityAtom({ query: { ...query } }));
    await settle(
      registry,
      bookingAvailabilityAtom({ query: { ...query, date: booking.dateIn(8) } })
    );
    unmount();

    expect(first).toMatchObject({
      success: { unavailableCoworkTiers: ["reserved-desk"] },
    });
    expect(bookingAvailabilityAtom({ query })).toBe(
      bookingAvailabilityAtom({ query: { ...query } })
    );
    expect(
      booking.endpoints.filter((endpoint) => endpoint === "getAvailability")
    ).toHaveLength(2);
  });

  test("sends the replaced pay state with availability", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);

    await settle(
      registry,
      meetingRoomStartTimesAtom({
        date: booking.dateIn(1),
        duration: "hour:4",
        replacingPayStateToken: "ps1.held",
      })
    );

    expect(booking.calls).toMatchObject([
      {
        endpoint: "getMeetingRoomStartTimes",
        input: { date: booking.dateIn(1), duration: "hour:4" },
      },
    ]);
  });

  test("keys meeting-room start times by date and duration", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    const date = booking.dateIn(1);

    const hour = await settle(
      registry,
      meetingRoomStartTimesAtom({ date, duration: "hour:1" })
    );
    const day = await settle(
      registry,
      meetingRoomStartTimesAtom({ date, duration: "day:1" })
    );

    expect(hour).toMatchObject({ success: { duration: "hour:1" } });
    expect(hour._tag === "Success" && hour.success.startTimes.length).toBe(10);
    expect(day._tag === "Success" && day.success.startTimes.length).toBe(1);
  });

  test("shares one quote between equal selections", () => {
    // The quote family is module-wide and the first selection of a key is the
    // one its atom reads, which can't encode an explicit `undefined`. A past
    // date keeps this key apart from the refresh tests' `dateIn` quotes, and
    // asking for the plain selection first keeps the cached atom readable.
    const date = "2020-01-06";
    const selection = coworkSelection(date);
    const reordered: CustomerBookingSelection = {
      coffee: true,
      date,
      tier: "open-space",
      family: "cowork",
      monitorOption: undefined,
    };
    const shared = bookingQuoteAtom(selection, "en-US");

    expect(bookingQuoteAtom(reordered, "en-US")).toBe(shared);
    expect(bookingQuoteAtom(selection, "cs-CZ")).not.toBe(
      bookingQuoteAtom(selection, "en-US")
    );
  });
});

describe("bookingQuoteAtom request", () => {
  test("reads a selection that spells out an absent option as undefined", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      {
        ...coworkSelection(harness.booking.dateIn(23)),
        monitorOption: undefined,
      },
      "en-US"
    );
    const unmount = harness.registry.mount(atom);
    const result = await settle(harness.registry, atom);
    unmount();

    expect(result._tag).toBe("Success");
    expect(quoteCalls(harness)).toBe(1);
  });
});

describe("bookingQuoteAtom early setup", () => {
  const meetingRoom = (date: string): CustomerBookingSelection => ({
    family: "meeting-room",
    date,
    startTime: "14:00",
    duration: "hour:1",
  });

  test("keeps a quote with early setup apart from one without", () => {
    const selection = meetingRoom("2020-01-06");
    expect(bookingQuoteAtom(selection, "en-US", { earlySetup: true })).not.toBe(
      bookingQuoteAtom(selection, "en-US")
    );
    expect(bookingQuoteAtom(selection, "en-US", { earlySetup: false })).toBe(
      bookingQuoteAtom(selection, "en-US")
    );
  });

  test("asks for the early setup, which the quote's room line then lists", async () => {
    const harness = withTestClock();
    const selection = meetingRoom(harness.booking.dateIn(20));
    const earlySetupOf = async (earlySetup: boolean) => {
      const atom = bookingQuoteAtom(selection, "en-US", { earlySetup });
      const unmount = harness.registry.mount(atom);
      const result = await settle(harness.registry, atom);
      unmount();
      return result._tag === "Success"
        ? result.success.summary.sections[0]?.items[0]?.earlySetup
        : "failed";
    };

    expect(await earlySetupOf(true)).toMatchObject({
      startsAt: expect.any(String),
    });
    expect(await earlySetupOf(false)).toBeUndefined();
  });
});

describe("bookingOfferingsAtom rollover", () => {
  // A minute before Prague midnight (CET) ends 17 November 2026.
  const beforeMidnight = new Date("2026-11-17T22:59:00Z");
  const afterMidnight = new Date("2026-11-17T23:00:30Z");

  /** A mounted offerings read on a test clock a minute before midnight. */
  const mountedBeforeMidnight = async () => {
    const harness = withTestClock();
    harness.booking.now = () => beforeMidnight;
    const atom = bookingOfferingsAtom("en-US");
    harness.registry.mount(atom);
    await settle(harness.registry, atom);
    // The test clock starts at the epoch, and the mounted read keeps its
    // runtime; move the clock to the instant the server answered at.
    await harness.adjust(Duration.millis(beforeMidnight.getTime()));
    await flush();
    const offeringsCalls = () =>
      harness.booking.endpoints.filter(
        (endpoint) => endpoint === "listOfferings"
      ).length;
    return { ...harness, atom, offeringsCalls };
  };

  test("reads the offerings again once the Prague date passes their advertisedOn", async () => {
    const harness = await mountedBeforeMidnight();

    await harness.adjust(Duration.seconds(59));
    await flush();
    expect(harness.offeringsCalls()).toBe(1);

    harness.booking.now = () => afterMidnight;
    await harness.adjust(Duration.seconds(1));
    await flush();
    const next = await settle(harness.registry, harness.atom);

    expect(harness.offeringsCalls()).toBe(2);
    expect(next._tag === "Success" && next.success.advertisedOn).toBe(
      "2026-11-18"
    );
  });

  test("asks a server still answering for the day before again after a pause, not in a loop", async () => {
    const harness = await mountedBeforeMidnight();

    // The server's clock lags: it still answers for 17 November.
    await harness.adjust(Duration.minutes(1));
    await flush();
    await settle(harness.registry, harness.atom);
    expect(harness.offeringsCalls()).toBe(2);

    await harness.adjust(
      Duration.millis(Duration.toMillis(offeringsRolloverRetryDelay) - 1)
    );
    await flush();
    expect(harness.offeringsCalls()).toBe(2);

    harness.booking.now = () => afterMidnight;
    await harness.adjust(Duration.millis(1));
    await flush();
    await settle(harness.registry, harness.atom);
    expect(harness.offeringsCalls()).toBe(3);
  });
});

describe("bookingQuoteAtom refresh", () => {
  test("reads the quote again every four minutes while mounted", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(20)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);

    const first = await settle(harness.registry, atom);
    await harness.adjust(quoteRefreshInterval);
    await flush();
    const second = await settle(harness.registry, atom);

    expect(quoteCalls(harness)).toBe(2);
    expect(
      first._tag === "Success" &&
        second._tag === "Success" &&
        first.success.advertisedPriceToken !==
          second.success.advertisedPriceToken
    ).toBe(true);

    unmount();
    await flush();
    await harness.adjust(quoteRefreshInterval);
    await flush();
    expect(quoteCalls(harness)).toBe(2);
  });

  test("restarts the wait when the quote is read again by hand", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(22)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);
    await settle(harness.registry, atom);

    await harness.adjust("2 minutes");
    harness.registry.refresh(atom);
    await flush();
    await settle(harness.registry, atom);
    await harness.adjust("3 minutes");
    await flush();
    const beforeNewInterval = quoteCalls(harness);
    await harness.adjust("1 minute");
    await flush();
    await settle(harness.registry, atom);
    unmount();

    expect(beforeNewInterval).toBe(2);
    expect(quoteCalls(harness)).toBe(3);
  });

  test("keeps reading the quote automatically with the account read budget spent", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(21)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);
    await settle(harness.registry, atom);

    await spendReads(harness.registry, accountReadAllowance.reads);
    await harness.adjust(quoteRefreshInterval);
    await flush();
    const refreshed = await settle(harness.registry, atom);
    unmount();

    expect(refreshed._tag).toBe("Success");
    expect(quoteCalls(harness)).toBe(2);
  });

  test("stops the automatic reads once a refresh is rate limited", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(26)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);
    await settle(harness.registry, atom);

    harness.booking.fail("getQuote", "rate-limited");
    await harness.adjust(quoteRefreshInterval);
    await flush();
    const limited = await settle(harness.registry, atom);
    await harness.adjust(quoteRefreshInterval);
    await flush();
    await harness.adjust(quoteRefreshInterval);
    await flush();
    unmount();

    expect(
      limited._tag === "Failure" && toBookingQueryError(limited.failure)
    ).toMatchObject({ _tag: "RateLimited" });
    // The rate-limited answer never reaches the fake's handler, and any later
    // automatic read would.
    expect(quoteCalls(harness)).toBe(1);
  });
});

/**
 * Lets the runtime's fibers and the registry's scheduled tasks run. Both
 * queue on `setImmediate`, which the fake timers leave real.
 */
const drain = async () => {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/**
 * Moves the fake timers, which drive both the registry's idle sweep and the
 * runtime's sleeps, after letting a just-unmounted atom start its idle wait.
 */
const elapse = async (duration: Duration.Input) => {
  await drain();
  jest.advanceTimersByTime(
    Duration.toMillis(Duration.fromInputUnsafe(duration))
  );
  await drain();
};

/** The registry sweeps idle atoms in one-second buckets. */
const pastIdleTTL = (ttl: Duration.Duration) =>
  Duration.sum(ttl, Duration.seconds(1));

describe("catalog idle TTL", () => {
  const registries: AtomRegistry.AtomRegistry[] = [];
  /** A fake-data registry, disposed after the test while time is still fake. */
  const fakeCustomerData = () => {
    const data = makeFakeCustomerData("linked");
    registries.push(data.registry);
    return { registry: data.registry, booking: fakeBooking(data.workspace) };
  };

  beforeEach(() => {
    // Mid-morning in Prague, so moving the clock never crosses into another
    // booking day.
    jest.useFakeTimers({ now: new Date("2026-11-10T09:00:00Z") });
  });
  afterEach(() => {
    for (const registry of registries.splice(0)) {
      registry.dispose();
    }
    jest.useRealTimers();
  });

  const readsOf = (
    booking: ReturnType<typeof fakeBooking>,
    endpoint: BookingEndpointName
  ) => booking.endpoints.filter((called) => called === endpoint).length;

  test.each(catalogReads)(
    "reuses the $name read when the screen comes back within its idle TTL",
    async ({ endpoint, idleTTL, atom }) => {
      const { registry, booking } = fakeCustomerData();
      const read = atom(booking);

      await settle(registry, read);
      await elapse(Duration.subtract(idleTTL, Duration.seconds(1)));
      const again = await settle(registry, read);

      expect(again._tag).toBe("Success");
      expect(readsOf(booking, endpoint)).toBe(1);
    }
  );

  test.each(catalogReads)(
    "reads the $name again when the screen comes back after its idle TTL",
    async ({ endpoint, idleTTL, atom }) => {
      const { registry, booking } = fakeCustomerData();
      const read = atom(booking);

      await settle(registry, read);
      await elapse(pastIdleTTL(idleTTL));
      await settle(registry, read);

      expect(readsOf(booking, endpoint)).toBe(2);
    }
  );

  test("doesn't refresh a quote no screen shows", async () => {
    const { registry, booking } = fakeCustomerData();
    const atom = bookingQuoteAtom(coworkSelection(booking.dateIn(23)), "en-US");

    await settle(registry, atom);
    await elapse(quoteRefreshInterval);
    await elapse(quoteRefreshInterval);

    expect(readsOf(booking, "getQuote")).toBe(1);
  });

  test("drops an idle quote whose refresh fell due, and reads it on return", async () => {
    const { registry, booking } = fakeCustomerData();
    const atom = bookingQuoteAtom(coworkSelection(booking.dateIn(24)), "en-US");
    const unmount = registry.mount(atom);
    const first = await settle(registry, atom);

    await elapse(Duration.subtract(quoteRefreshInterval, Duration.seconds(30)));
    unmount();
    await elapse("40 seconds");
    const readsWhileIdle = readsOf(booking, "getQuote");
    const returned = await settle(registry, atom);

    expect(readsWhileIdle).toBe(1);
    expect(readsOf(booking, "getQuote")).toBe(2);
    expect(
      first._tag === "Success" &&
        returned._tag === "Success" &&
        first.success.advertisedPriceToken !==
          returned.success.advertisedPriceToken
    ).toBe(true);
  });

  test("reads a quote whose refresh was rate limited again when a screen comes back", async () => {
    const { registry, booking } = fakeCustomerData();
    const atom = bookingQuoteAtom(coworkSelection(booking.dateIn(25)), "en-US");
    const unmount = registry.mount(atom);
    const first = await settle(registry, atom);
    booking.fail("getQuote", "rate-limited");

    await elapse(quoteRefreshInterval);
    // Past the ten minutes the quote's token lasts, still on screen.
    await elapse("7 minutes");
    const shown = await settle(registry, atom);
    // The rate-limited answer never reaches the fake's handler.
    const readsWhileShown = readsOf(booking, "getQuote");
    unmount();
    await elapse("100 millis");
    const unmountReturn = registry.mount(atom);
    const onReturn = registry.get(atom);
    const returned = await settle(registry, atom);
    unmountReturn();

    expect(
      shown._tag === "Failure" && toBookingQueryError(shown.failure)
    ).toMatchObject({ _tag: "RateLimited" });
    expect(readsWhileShown).toBe(1);
    expect(
      onReturn._tag === "Success" &&
        !onReturn.waiting &&
        first._tag === "Success" &&
        onReturn.value.advertisedPriceToken ===
          first.success.advertisedPriceToken
    ).toBe(false);
    expect(readsOf(booking, "getQuote")).toBe(2);
    expect(
      first._tag === "Success" &&
        returned._tag === "Success" &&
        first.success.advertisedPriceToken !==
          returned.success.advertisedPriceToken
    ).toBe(true);
  });
});

describe("toBookingQueryError", () => {
  test("maps the catalog tags", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    booking.officeClosed = true;

    const outOfRange = await settle(
      registry,
      bookingQuoteAtom(coworkSelection(booking.dateIn(400)), "en-US")
    );
    const closed = await settle(
      registry,
      bookingQuoteAtom(
        { family: "office", date: booking.dateIn(2), seats: 2 },
        "en-US"
      )
    );
    booking.reject(
      "getAvailability",
      new CustomerBookingSelectionInvalid({ field: "seats" })
    );
    const invalid = await settle(
      registry,
      bookingAvailabilityAtom({ query: { kind: "office" } })
    );

    expect(
      outOfRange._tag === "Failure" && toBookingQueryError(outOfRange.failure)
    ).toMatchObject({
      _tag: "DateOutOfRange",
      earliest: booking.today(),
      latest: booking.dateIn(183),
    });
    expect(
      closed._tag === "Failure" && toBookingQueryError(closed.failure)
    ).toMatchObject({ _tag: "OfferingUnavailable", family: "office" });
    expect(
      invalid._tag === "Failure" && toBookingQueryError(invalid.failure)
    ).toMatchObject({ _tag: "SelectionInvalid", field: "seats" });
  });

  test("falls through to the shared view errors", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    booking.fail("listOfferings", "rate-limited");
    booking.fail("listLegalDocuments", "service-unavailable");

    const limited = await settle(registry, bookingOfferingsAtom("en-US"));
    const unavailable = await settle(registry, legalDocumentsAtom("en-US"));

    expect(
      limited._tag === "Failure" && toBookingQueryError(limited.failure)
    ).toMatchObject({ _tag: "RateLimited" });
    expect(
      unavailable._tag === "Failure" && toBookingQueryError(unavailable.failure)
    ).toMatchObject({ _tag: "Unavailable" });
  });
});
