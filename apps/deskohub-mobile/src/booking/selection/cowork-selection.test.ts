import { describe, expect, test } from "bun:test";
import type {
  CustomerAvailability,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { sampleBookableDates } from "../testing/sample-booking-catalog";
import {
  type CoworkAvailability,
  type CoworkDraft,
  coworkAvailabilityQueries,
  coworkDraftFromSelection,
  coworkEnablement,
  coworkOvernightStay,
  defaultCoworkDraft,
  fitCoworkStay,
  freeCoworkTierOn,
  normalizeCoworkWorkstation,
  selectCoworkDate,
  selectCoworkStay,
  selectCoworkTier,
  selectCoworkWorkstation,
  toCoworkSelection,
} from "./cowork-selection";
import { pragueToday } from "./prague-date";

const money = { value: 0, exponent: 2, currency: "CZK" };
const advertisedPrice = { price: money, discount: money };
const today = "2026-11-07";
/** The server's cowork window for `today`: six months. */
const bookableDates = { earliest: today, latest: "2027-05-07" };

const coworkOffering = (
  tier: "open-space" | "reserved-desk"
): CustomerOffering => ({
  family: "cowork",
  tier,
  name: tier,
  description: "",
  usage: "",
  price: money,
  advertisedPrice,
  bookableDates,
  addOns:
    tier === "reserved-desk"
      ? [
          { id: "coffee", name: "Coffee", price: money, included: true },
          {
            id: "workstation",
            name: "Workstation",
            price: money,
            included: false,
            options: [
              { id: "2x27-qhd", name: "2× 27″ QHD" },
              { id: "2x32-qhd", name: "2× 32″ QHD" },
              { id: "2x27-4k", name: "2× 27″ 4K" },
              { id: "2x32-4k", name: "2× 32″ 4K" },
            ],
          },
        ]
      : [{ id: "coffee", name: "Coffee", price: money, included: false }],
});

const offerings = [
  coworkOffering("open-space"),
  coworkOffering("reserved-desk"),
];

const availability = (
  overrides: Partial<CustomerAvailability> = {}
): CustomerAvailability => ({
  from: "2026-11-07",
  to: "2027-05-07",
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const settled = (
  overrides: Partial<CustomerAvailability> = {}
): CoworkAvailability => ({
  range: Option.some(availability(overrides)),
  selection: Option.some(availability(overrides)),
  workstationRequirement: Option.some(availability(overrides)),
});

// Saturday 7 November 2026, 10:00 in Prague (CET).
const morning = new Date("2026-11-07T09:00:00Z");

/** The default draft on a picked day. */
const draftOn = (date: string) =>
  selectCoworkDate(defaultCoworkDraft(offerings), date);

const reservedDesk: CoworkDraft = selectCoworkTier(
  draftOn(today),
  "reserved-desk"
);

const blockerTags = (
  draft: CoworkDraft,
  now: Date,
  coworkAvailability: CoworkAvailability
) =>
  coworkEnablement(draft, {
    now,
    offerings,
    // The window the server advertises on `now`'s Prague date.
    bookableDates: sampleBookableDates(pragueToday(now), "cowork"),
    availability: coworkAvailability,
  }).blockers.map((blocker) => blocker._tag);

describe("defaultCoworkDraft", () => {
  test("opens on Open Space without a date, coffee or a workstation", () => {
    expect(defaultCoworkDraft(offerings)).toEqual({
      tier: "open-space",
      stay: "day",
      date: Option.none(),
      coffee: false,
      workstation: Option.none(),
    });
  });

  test("falls back to the first tier offered without Open Space", () => {
    expect(defaultCoworkDraft([coworkOffering("reserved-desk")]).tier).toBe(
      "reserved-desk"
    );
  });
});

describe("coworkDraftFromSelection", () => {
  test("opens on a booked selection's tier, day and extras", () => {
    const booked = {
      family: "cowork",
      date: "2026-11-20",
      tier: "reserved-desk",
      monitorOption: "2x32-4k",
    } as const;

    const draft = Option.getOrThrow(
      coworkDraftFromSelection(booked, offerings)
    );

    expect(toCoworkSelection(draft)).toEqual(Option.some(booked));
  });

  test("drops a day that can no longer be booked", () => {
    const draft = coworkDraftFromSelection(
      {
        family: "cowork",
        date: "2026-10-01",
        tier: "open-space",
        coffee: true,
      },
      offerings
    );

    expect(Option.map(draft, ({ date, coffee }) => ({ date, coffee }))).toEqual(
      Option.some({ date: Option.none(), coffee: true })
    );
  });

  test("ignores another family and a tier no longer offered", () => {
    expect(
      coworkDraftFromSelection(
        { family: "meeting-room", date: today, duration: "hour:1" },
        offerings
      )
    ).toEqual(Option.none());
    expect(
      coworkDraftFromSelection(
        { family: "cowork", date: today, tier: "reserved-desk" },
        [coworkOffering("open-space")]
      )
    ).toEqual(Option.none());
  });
});

describe("toCoworkSelection", () => {
  test("sends coffee for Open Space", () => {
    const draft = { ...draftOn(today), coffee: true };

    expect(toCoworkSelection(draft)).toEqual(
      Option.some({
        family: "cowork",
        date: today,
        tier: "open-space",
        coffee: true,
      })
    );
  });

  test("leaves coffee out for a Reserved Desk, which includes it", () => {
    const draft = { ...reservedDesk, coffee: true };

    expect(toCoworkSelection(draft)).toEqual(
      Option.some({ family: "cowork", date: today, tier: "reserved-desk" })
    );
  });

  test("sends a Reserved Desk's workstation", () => {
    const draft = selectCoworkWorkstation(reservedDesk, Option.some("2x27-4k"));

    expect(Option.getOrThrow(toCoworkSelection(draft)).monitorOption).toBe(
      "2x27-4k"
    );
  });

  test("drops the workstation when switching to Open Space", () => {
    const draft = selectCoworkTier(
      selectCoworkWorkstation(reservedDesk, Option.some("2x27-4k")),
      "open-space"
    );

    expect(draft.workstation).toEqual(Option.none());
    expect(
      Option.getOrThrow(toCoworkSelection(draft)).monitorOption
    ).toBeUndefined();
  });

  test("names no booking until a day is picked", () => {
    expect(toCoworkSelection(defaultCoworkDraft(offerings))).toEqual(
      Option.none()
    );
  });
});

describe("coworkAvailabilityQueries", () => {
  test("asks for the tier's six-month calendar and the selected date", () => {
    const queries = coworkAvailabilityQueries(draftOn(today), bookableDates);

    expect(queries).toEqual({
      range: {
        kind: "cowork",
        from: "2026-11-07",
        to: "2027-05-07",
        entryTier: "open-space",
      },
      selection: Option.some({
        kind: "cowork",
        from: today,
        to: today,
        entryTier: "open-space",
        date: today,
      }),
      workstationRequirement: Option.none(),
    });
  });

  test("reads only the tier's calendar before a day is picked", () => {
    const queries = coworkAvailabilityQueries(
      selectCoworkTier(defaultCoworkDraft(offerings), "reserved-desk"),
      bookableDates
    );

    expect(queries.range.entryTier).toBe("reserved-desk");
    expect(queries.selection).toEqual(Option.none());
    expect(queries.workstationRequirement).toEqual(Option.none());
  });

  test("asks for the calendar over the window the offering gives", () => {
    const { range } = coworkAvailabilityQueries(draftOn(today), {
      earliest: today,
      latest: "2026-11-20",
    });

    expect(range).toMatchObject({ from: today, to: "2026-11-20" });
  });

  test("checks a Reserved Desk's workstation and its requirement apart", () => {
    const draft = selectCoworkWorkstation(reservedDesk, Option.some("2x32-4k"));
    const queries = coworkAvailabilityQueries(draft, bookableDates);

    expect(Option.getOrThrow(queries.selection).monitorOption).toBe("2x32-4k");
    expect(queries.workstationRequirement).toEqual(
      Option.some({
        kind: "cowork",
        from: today,
        to: today,
        entryTier: "reserved-desk",
        date: today,
      })
    );
  });
});

describe("coworkEnablement", () => {
  test("offers today through six months and disables taken dates", () => {
    const enablement = coworkEnablement(draftOn(today), {
      now: morning,
      offerings,
      bookableDates,
      availability: settled({ unavailableDates: ["2026-11-10"] }),
    });

    expect(enablement.dates.earliest).toBe(today);
    expect(enablement.dates.latest).toBe("2027-05-07");
    expect([...enablement.dates.unavailable]).toEqual(["2026-11-10"]);
    expect(enablement.blockers).toEqual([]);
  });

  test("follows a shorter window the offering gives", () => {
    const shortWindow = { earliest: today, latest: "2026-11-20" };
    const enablementOn = (date: string) =>
      coworkEnablement(draftOn(date), {
        now: morning,
        offerings,
        bookableDates: shortWindow,
        availability: settled(),
      });

    expect(enablementOn(today).dates).toMatchObject(shortWindow);
    expect(enablementOn("2026-11-21").blockers.map(({ _tag }) => _tag)).toEqual(
      expect.arrayContaining(["DateOutOfRange"])
    );
  });

  test("keeps a date selectable for a Reserved Desk that only needs a workstation", () => {
    const enablement = coworkEnablement(reservedDesk, {
      now: morning,
      offerings,
      bookableDates,
      availability: settled({
        unavailableDates: ["2026-11-10", "2026-11-11"],
        reservedDeskWorkstationRequiredDates: ["2026-11-10"],
      }),
    });

    expect([...enablement.dates.unavailable]).toEqual(["2026-11-11"]);
  });

  test("blocks an offer taken on its date", () => {
    expect(
      blockerTags(
        draftOn(today),
        morning,
        settled({ unavailableCoworkTiers: ["open-space"] })
      )
    ).toEqual(["OfferUnavailable"]);
  });

  test("waits for every query the tier needs", () => {
    expect(
      blockerTags(reservedDesk, morning, {
        ...settled(),
        workstationRequirement: Option.none(),
      })
    ).toEqual(["AvailabilityPending"]);
    expect(
      blockerTags(draftOn(today), morning, {
        ...settled(),
        workstationRequirement: Option.none(),
      })
    ).toEqual([]);
  });

  test("asks for a day before anything else, without the day's reads", () => {
    expect(
      blockerTags(defaultCoworkDraft(offerings), morning, {
        range: Option.some(availability()),
        selection: Option.none(),
        workstationRequirement: Option.none(),
      })
    ).toEqual(["DateRequired"]);
  });

  test("blocks a date outside today through six months", () => {
    const draft = draftOn("2027-05-08");

    expect(blockerTags(draft, morning, settled())).toEqual(["DateOutOfRange"]);
  });

  describe("same-day Open Space", () => {
    const openSpace = draftOn(today);

    test("closes at 17:00 Prague time", () => {
      expect(
        blockerTags(openSpace, new Date("2026-11-07T15:59:00Z"), settled())
      ).toEqual([]);
      expect(
        blockerTags(openSpace, new Date("2026-11-07T16:00:00Z"), settled())
      ).toEqual(["OpenSpaceClosedToday"]);
    });

    test("closes at 17:00 Prague summer time", () => {
      const summer = selectCoworkDate(openSpace, "2026-07-01");

      expect(
        blockerTags(summer, new Date("2026-07-01T14:59:00Z"), settled())
      ).toEqual([]);
      expect(
        blockerTags(summer, new Date("2026-07-01T15:00:00Z"), settled())
      ).toEqual(["OpenSpaceClosedToday"]);
    });

    test("doesn't affect tomorrow or a Reserved Desk", () => {
      const evening = new Date("2026-11-07T18:00:00Z");

      expect(
        blockerTags(
          selectCoworkDate(openSpace, "2026-11-08"),
          evening,
          settled()
        )
      ).toEqual([]);
      expect(blockerTags(reservedDesk, evening, settled())).toEqual([]);
    });
  });

  describe("Reserved Desk workstation", () => {
    const requiresWorkstation = settled({
      unavailableDates: [today],
      reservedDeskWorkstationRequiredDates: [today],
      unavailableMonitorOptions: ["2x27-qhd"],
    });

    test("requires the first free workstation when no bare desk is left", () => {
      const enablement = coworkEnablement(reservedDesk, {
        now: morning,
        offerings,
        bookableDates,
        availability: requiresWorkstation,
      });

      expect(enablement.workstationRequired).toBe(true);
      expect(enablement.requiredWorkstation).toEqual(Option.some("2x32-qhd"));
      expect(enablement.workstations.map(({ id }) => id)).toEqual([
        "2x27-qhd",
        "2x32-qhd",
        "2x27-4k",
        "2x32-4k",
      ]);
      expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
        "WorkstationRequired",
      ]);
    });

    test("adds the required workstation and removes it once it isn't required", () => {
      const enablement = coworkEnablement(reservedDesk, {
        now: morning,
        offerings,
        bookableDates,
        availability: requiresWorkstation,
      });
      const added = normalizeCoworkWorkstation(
        reservedDesk,
        requiresWorkstation,
        enablement
      );

      expect(added.workstation).toEqual(
        Option.some({ option: "2x32-qhd", origin: "requirement" })
      );
      expect(blockerTags(added, morning, requiresWorkstation)).toEqual([]);

      const bareDesk = settled();
      const removed = normalizeCoworkWorkstation(
        added,
        bareDesk,
        coworkEnablement(added, {
          now: morning,
          offerings,
          bookableDates,
          availability: bareDesk,
        })
      );
      expect(removed.workstation).toEqual(Option.none());
    });

    test("replaces a taken choice and keeps the customer's free one", () => {
      const taken = selectCoworkWorkstation(
        reservedDesk,
        Option.some("2x27-qhd")
      );
      const replaced = normalizeCoworkWorkstation(
        taken,
        requiresWorkstation,
        coworkEnablement(taken, {
          now: morning,
          offerings,
          bookableDates,
          availability: requiresWorkstation,
        })
      );
      expect(replaced.workstation).toEqual(
        Option.some({ option: "2x32-qhd", origin: "customer" })
      );

      const bareDesk = settled();
      expect(
        normalizeCoworkWorkstation(
          replaced,
          bareDesk,
          coworkEnablement(replaced, {
            now: morning,
            offerings,
            bookableDates,
            availability: bareDesk,
          })
        )
      ).toBe(replaced);
    });

    test("blocks a taken optional workstation without replacing it", () => {
      const takenOnly = settled({ unavailableMonitorOptions: ["2x27-4k"] });
      const draft = selectCoworkWorkstation(
        reservedDesk,
        Option.some("2x27-4k")
      );
      const enablement = coworkEnablement(draft, {
        now: morning,
        offerings,
        bookableDates,
        availability: takenOnly,
      });

      expect(normalizeCoworkWorkstation(draft, takenOnly, enablement)).toBe(
        draft
      );
      expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
        "WorkstationUnavailable",
      ]);
    });

    test("stays required and blocked when every workstation is taken", () => {
      const noneFree = settled({
        reservedDeskWorkstationRequiredDates: [today],
        unavailableMonitorOptions: [
          "2x27-qhd",
          "2x32-qhd",
          "2x27-4k",
          "2x32-4k",
        ],
      });
      const enablement = coworkEnablement(reservedDesk, {
        now: morning,
        offerings,
        bookableDates,
        availability: noneFree,
      });

      expect(enablement.requiredWorkstation).toEqual(Option.none());
      expect(
        normalizeCoworkWorkstation(reservedDesk, noneFree, enablement)
      ).toBe(reservedDesk);
      expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
        "WorkstationRequired",
      ]);
    });

    test("waits for the date's queries before normalizing", () => {
      const pending = { ...requiresWorkstation, selection: Option.none() };

      expect(
        normalizeCoworkWorkstation(
          reservedDesk,
          pending,
          coworkEnablement(reservedDesk, {
            now: morning,
            offerings,
            bookableDates,
            availability: pending,
          })
        )
      ).toBe(reservedDesk);
    });
  });

  test("shows only the selected date's notices", () => {
    const notice = { date: today, startsAt: "10:00", endsAt: "12:00" };
    const enablement = coworkEnablement(draftOn(today), {
      now: morning,
      offerings,
      bookableDates,
      availability: settled({
        notices: [notice, { ...notice, date: "2026-11-08" }],
      }),
    });

    expect(enablement.notices).toEqual([notice]);
  });
});

describe("freeCoworkTierOn", () => {
  test("names the other tier while it is free that day", () => {
    expect(
      Option.map(
        freeCoworkTierOn(
          availability({ unavailableCoworkTiers: ["open-space"] }),
          offerings,
          "open-space"
        ),
        (offering) => offering.family === "cowork" && offering.tier
      )
    ).toEqual(Option.some("reserved-desk"));
  });

  test("names none when every tier is taken or none other is offered", () => {
    expect(
      freeCoworkTierOn(
        availability({
          unavailableCoworkTiers: ["open-space", "reserved-desk"],
        }),
        offerings,
        "open-space"
      )
    ).toEqual(Option.none());
    expect(
      freeCoworkTierOn(
        availability(),
        [coworkOffering("open-space")],
        "open-space"
      )
    ).toEqual(Option.none());
  });
});

describe("overnight stay", () => {
  const overnightStay = { startTime: "12:00", endTime: "12:00" };
  const overnightOfferings = [
    coworkOffering("open-space"),
    { ...coworkOffering("reserved-desk"), overnightStay },
  ];
  const overnight = selectCoworkStay(reservedDesk, "overnight");
  const stays = (queries: ReturnType<typeof coworkAvailabilityQueries>) => [
    queries.range.stay,
    Option.getOrThrow(queries.selection).stay,
    Option.getOrThrow(queries.workstationRequirement).stay,
  ];

  test("is offered only while the catalog's Reserved Desk advertises it", () => {
    expect(coworkOvernightStay(overnightOfferings)).toEqual(
      Option.some(overnightStay)
    );
    expect(coworkOvernightStay(offerings)).toEqual(Option.none());
  });

  test("books an overnight Reserved Desk as a stay; a day names none", () => {
    expect(Option.getOrThrow(toCoworkSelection(overnight)).stay).toBe(
      "overnight"
    );
    expect(
      Option.getOrThrow(toCoworkSelection(reservedDesk))
    ).not.toHaveProperty("stay");
  });

  test("reads the overnight calendar and day; a day reads as before", () => {
    expect(stays(coworkAvailabilityQueries(overnight, bookableDates))).toEqual([
      "overnight",
      "overnight",
      "overnight",
    ]);
    expect(
      stays(coworkAvailabilityQueries(reservedDesk, bookableDates))
    ).toEqual([undefined, undefined, undefined]);
  });

  test("goes back to a day when switching to Open Space", () => {
    const openSpace = selectCoworkTier(overnight, "open-space");

    expect(openSpace.stay).toBe("day");
    expect(Option.getOrThrow(toCoworkSelection(openSpace))).not.toHaveProperty(
      "stay"
    );
    expect(
      coworkAvailabilityQueries(openSpace, bookableDates).range
    ).not.toHaveProperty("stay");
  });

  test("falls back to a day once the catalog stops advertising it", () => {
    expect(fitCoworkStay(overnight, overnightOfferings)).toBe(overnight);
    expect(fitCoworkStay(overnight, offerings).stay).toBe("day");
    expect(fitCoworkStay(reservedDesk, offerings)).toBe(reservedDesk);
  });

  test("reopens a booked overnight stay while it is still offered", () => {
    const booked = {
      family: "cowork",
      date: "2026-11-20",
      tier: "reserved-desk",
      stay: "overnight",
    } as const;
    const reopened = (catalog: ReadonlyArray<CustomerOffering>) =>
      Option.map(coworkDraftFromSelection(booked, catalog), toCoworkSelection);

    expect(reopened(overnightOfferings)).toEqual(
      Option.some(Option.some(booked))
    );
    expect(reopened(offerings)).toEqual(
      Option.some(
        Option.some({
          family: "cowork",
          date: "2026-11-20",
          tier: "reserved-desk",
        })
      )
    );
  });
});
