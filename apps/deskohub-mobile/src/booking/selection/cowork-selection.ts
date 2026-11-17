import type {
  CustomerAvailability,
  CustomerBookableCoworkTier,
  CustomerBookableDates,
  CustomerBookingSelection,
  CustomerCoworkStay,
  CustomerMonitorOption,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, Data, Option } from "effect";
import type { AvailabilityQuery, DateChoice } from "./booking-selection";
import { type PragueDate, pragueDateTimeAt } from "./prague-date";

/**
 * Where a Reserved Desk's workstation came from: the customer chose it, or
 * the screen added it because the date has no bare desk left. Only an added
 * one is removed again when the date stops requiring it.
 */
export type CoworkWorkstationOrigin = "customer" | "requirement";

/** A cowork booking the customer is putting together. */
export type CoworkDraft = {
  readonly tier: CustomerBookableCoworkTier;
  /**
   * Reserved Desk only, while its offering advertises an overnight stay;
   * `date` is then the arrival date. A day otherwise.
   */
  readonly stay: CustomerCoworkStay;
  /** None until the customer picks a day; the screen never picks one. */
  readonly date: Option.Option<PragueDate>;
  /** Open Space only; a Reserved Desk includes coffee. */
  readonly coffee: boolean;
  /** Reserved Desk only: the monitor workstation. */
  readonly workstation: Option.Option<{
    readonly option: CustomerMonitorOption;
    readonly origin: CoworkWorkstationOrigin;
  }>;
};

export type CoworkOffering = Extract<
  CustomerOffering,
  { readonly family: "cowork" }
>;

/** When an overnight stay starts on its arrival date and ends the next day. */
export type CoworkOvernightStay = NonNullable<CoworkOffering["overnightStay"]>;

// Bookable from 00:00 to 17:00 Prague time; same-day booking ends with it.
const openSpaceClosingHour = 17;
/** When Open Space access ends, Prague HH:mm. */
export const openSpaceClosingTime = `${openSpaceClosingHour}:00`;

/** The cowork tiers the catalog offers, in catalog order. */
export const coworkOfferings = (offerings: ReadonlyArray<CustomerOffering>) =>
  offerings.filter(
    (offering): offering is CoworkOffering => offering.family === "cowork"
  );

/**
 * The overnight stay the catalog's Reserved Desk advertises; none while it
 * can only be booked by the day.
 */
export const coworkOvernightStay = (
  offerings: ReadonlyArray<CustomerOffering>
): Option.Option<CoworkOvernightStay> =>
  Option.fromNullishOr(
    coworkOfferings(offerings).find(({ tier }) => tier === "reserved-desk")
      ?.overnightStay
  );

/**
 * The draft a cowork screen opens with: Open Space without a date or
 * coffee, or the first cowork tier offered when Open Space isn't.
 */
export const defaultCoworkDraft = (
  offerings: ReadonlyArray<CustomerOffering>
): CoworkDraft => {
  const tiers = coworkOfferings(offerings).map((offering) => offering.tier);
  return {
    tier: tiers.includes("open-space")
      ? "open-space"
      : (tiers[0] ?? "open-space"),
    stay: "day",
    date: Option.none(),
    coffee: false,
    workstation: Option.none(),
  };
};

/**
 * The draft a cowork screen opens with for a booked selection ("Book
 * again"): its tier and extras, and its day while that can still be booked.
 * None for another family or a tier the catalog no longer offers; a
 * workstation the catalog no longer offers is left out.
 */
export const coworkDraftFromSelection = (
  selection: CustomerBookingSelection,
  offerings: ReadonlyArray<CustomerOffering>
): Option.Option<CoworkDraft> => {
  const { tier } = selection;
  const offering = coworkOfferings(offerings).find(
    (candidate) => candidate.tier === tier
  );
  if (selection.family !== "cowork" || tier === undefined || !offering) {
    return Option.none();
  }
  const { earliest, latest } = offering.bookableDates;
  const offeredWorkstations =
    offering.addOns.find(({ id }) => id === "workstation")?.options ?? [];
  return Option.some(
    fitCoworkStay(
      {
        tier,
        stay: selection.stay ?? "day",
        date: Option.liftPredicate(
          selection.date,
          (date) => date >= earliest && date <= latest
        ),
        coffee: tier === "open-space" && selection.coffee === true,
        workstation: Option.fromNullishOr(selection.monitorOption).pipe(
          Option.filter((option) =>
            offeredWorkstations.some(({ id }) => id === option)
          ),
          Option.map((option) => ({ option, origin: "customer" as const }))
        ),
      },
      offerings
    )
  );
};

/**
 * The draft with a stay its tier and the catalog offer: an overnight stay
 * falls back to a day off a Reserved Desk, or once the catalog no longer
 * advertises one. The same draft when it already fits.
 */
export const fitCoworkStay = (
  draft: CoworkDraft,
  offerings: ReadonlyArray<CustomerOffering>
): CoworkDraft =>
  draft.stay === "day" ||
  (draft.tier === "reserved-desk" &&
    Option.isSome(coworkOvernightStay(offerings)))
    ? draft
    : { ...draft, stay: "day" };

/** The draft on the day the customer picked. */
export const selectCoworkDate = (
  draft: CoworkDraft,
  date: PragueDate
): CoworkDraft => ({ ...draft, date: Option.some(date) });

/**
 * The draft with another tier; Open Space drops the workstation and goes
 * back to a day.
 */
export const selectCoworkTier = (
  draft: CoworkDraft,
  tier: CustomerBookableCoworkTier
): CoworkDraft => ({
  ...draft,
  tier,
  stay: tier === "reserved-desk" ? draft.stay : "day",
  workstation: tier === "reserved-desk" ? draft.workstation : Option.none(),
});

/** The draft as a day or an overnight stay from its date. */
export const selectCoworkStay = (
  draft: CoworkDraft,
  stay: CustomerCoworkStay
): CoworkDraft => ({ ...draft, stay });

/**
 * The stay as the booking contract takes it: only an overnight Reserved
 * Desk names one, so a day books as it always has.
 */
const coworkStayFields = (draft: Pick<CoworkDraft, "tier" | "stay">) =>
  draft.tier === "reserved-desk" && draft.stay === "overnight"
    ? { stay: "overnight" as const }
    : {};

/** The draft with the customer's own workstation choice, or none. */
export const selectCoworkWorkstation = (
  draft: CoworkDraft,
  option: Option.Option<CustomerMonitorOption>
): CoworkDraft => ({
  ...draft,
  workstation: Option.map(option, (chosen) => ({
    option: chosen,
    origin: "customer" as const,
  })),
});

/**
 * The booking the draft names, as the quote and checkout take it; none
 * until it has a date.
 */
export const toCoworkSelection = (
  draft: CoworkDraft
): Option.Option<CustomerBookingSelection> =>
  Option.map(
    draft.date,
    (date): CustomerBookingSelection => ({
      family: "cowork",
      date,
      tier: draft.tier,
      ...coworkStayFields(draft),
      ...(draft.tier === "open-space"
        ? { coffee: draft.coffee }
        : Option.match(draft.workstation, {
            onNone: () => ({}),
            onSome: ({ option }) => ({ monitorOption: option }),
          })),
    })
  );

/** The availability queries a cowork screen reads for its draft. */
export type CoworkAvailabilityQueries = {
  /** The tier's calendar over its bookable dates. */
  readonly range: AvailabilityQuery;
  /** The drafted offer on its date alone, once it has one. */
  readonly selection: Option.Option<AvailabilityQuery>;
  /** Reserved Desk with a date only: whether it needs a workstation. */
  readonly workstationRequirement: Option.Option<AvailabilityQuery>;
};

/** The cowork offerings, one per tier; none while the catalog offers no tier. */
export const offeredCoworkTiers = (
  offerings: ReadonlyArray<CustomerOffering>
): Option.Option<Arr.NonEmptyReadonlyArray<CoworkOffering>> => {
  const tiers = coworkOfferings(offerings);
  return Arr.isReadonlyArrayNonEmpty(tiers)
    ? Option.some(tiers)
    : Option.none();
};

/**
 * The dates a cowork draft may pick from: its tier's offering's bookable
 * dates, else the first tier's while the catalog no longer offers the
 * drafted one.
 */
export const coworkBookableDates = (
  tiers: Arr.NonEmptyReadonlyArray<CoworkOffering>,
  tier: CustomerBookableCoworkTier
): CustomerBookableDates =>
  (tiers.find((offering) => offering.tier === tier) ?? tiers[0]).bookableDates;

export const coworkAvailabilityQueries = (
  draft: CoworkDraft,
  { earliest, latest }: CustomerBookableDates
): CoworkAvailabilityQueries => {
  const selectedDate = Option.map(draft.date, coworkDayQuery(draft));
  const isReservedDesk = draft.tier === "reserved-desk";
  return {
    range: {
      kind: "cowork",
      from: earliest,
      to: latest,
      entryTier: draft.tier,
      ...coworkStayFields(draft),
    },
    selection: Option.map(selectedDate, (query) =>
      Option.match(
        Option.filter(draft.workstation, () => isReservedDesk),
        {
          onNone: () => query,
          onSome: ({ option }) => ({ ...query, monitorOption: option }),
        }
      )
    ),
    workstationRequirement: Option.filter(selectedDate, () => isReservedDesk),
  };
};

/**
 * One day's availability as seen from a tier and stay: its
 * `unavailableCoworkTiers` say which tiers are taken that day.
 */
export const coworkDayQuery =
  (draft: Pick<CoworkDraft, "tier" | "stay">) =>
  (date: PragueDate): AvailabilityQuery => ({
    kind: "cowork",
    from: date,
    to: date,
    entryTier: draft.tier,
    ...coworkStayFields(draft),
    date,
  });

/**
 * Availability settled for the current `coworkAvailabilityQueries`; none
 * while a query is loading.
 */
export type CoworkAvailability = {
  readonly range: Option.Option<CustomerAvailability>;
  readonly selection: Option.Option<CustomerAvailability>;
  readonly workstationRequirement: Option.Option<CustomerAvailability>;
};

/** Why a cowork draft can't continue to checkout. */
export type CoworkBlocker = Data.TaggedEnum<{
  /** No day picked yet. */
  DateRequired: Record<never, never>;
  /** A query the draft needs hasn't settled. */
  AvailabilityPending: Record<never, never>;
  DateOutOfRange: Record<never, never>;
  /** Same-day Open Space can't be booked from 17:00 Prague time. */
  OpenSpaceClosedToday: Record<never, never>;
  /** The tier is taken or not offered on the date. */
  OfferUnavailable: Record<never, never>;
  /** The chosen workstation is taken on the date. */
  WorkstationUnavailable: Record<never, never>;
  /** The date has no bare desk left and no workstation is free either. */
  WorkstationRequired: Record<never, never>;
}>;
export const CoworkBlocker = Data.taggedEnum<CoworkBlocker>();

/** What a cowork screen offers and disables for its draft. */
export type CoworkEnablement = {
  readonly dates: DateChoice;
  /** Tiers taken on the date, or across the calendar before it settles. */
  readonly unavailableTiers: ReadonlySet<string>;
  /** Whether Open Space can no longer be booked for today. */
  readonly openSpaceClosedToday: boolean;
  /** The Reserved Desk workstation configurations, in catalog order. */
  readonly workstations: ReadonlyArray<{
    readonly id: CustomerMonitorOption;
    readonly name: string;
  }>;
  readonly unavailableWorkstations: ReadonlySet<CustomerMonitorOption>;
  /**
   * The workstation a Reserved Desk takes when its date has no bare desk
   * left: the first free one. None when the date doesn't require one, or
   * when every workstation is taken.
   */
  readonly requiredWorkstation: Option.Option<CustomerMonitorOption>;
  /** Whether the date has no bare desk left, so a workstation is required. */
  readonly workstationRequired: boolean;
  /** The selected date's Calendar limitations. */
  readonly notices: CustomerAvailability["notices"];
  readonly blockers: ReadonlyArray<CoworkBlocker>;
};

/**
 * Whether a cowork offer can be booked on its date: a Reserved Desk stays
 * bookable on a date that only requires a workstation.
 */
export const isOfferAvailable = (
  availability: CustomerAvailability,
  draft: {
    readonly date: PragueDate;
    readonly tier: CustomerBookableCoworkTier;
  }
) =>
  !(
    availability.unavailableCoworkTiers.includes(draft.tier) ||
    (availability.unavailableDates.includes(draft.date) &&
      !(
        draft.tier === "reserved-desk" &&
        availability.reservedDeskWorkstationRequiredDates.includes(draft.date)
      ))
  );

const isOpenSpaceClosedToday = (now: Date) =>
  pragueDateTimeAt(now).hour >= openSpaceClosingHour;

export const coworkEnablement = (
  draft: CoworkDraft,
  context: {
    readonly now: Date;
    readonly offerings: ReadonlyArray<CustomerOffering>;
    /** The drafted tier's bookable dates (`coworkBookableDates`). */
    readonly bookableDates: CustomerBookableDates;
    readonly availability: CoworkAvailability;
  }
): CoworkEnablement => {
  const { range, selection, workstationRequirement } = context.availability;
  const today = pragueDateTimeAt(context.now).date;
  const { earliest, latest } = context.bookableDates;
  const isReservedDesk = draft.tier === "reserved-desk";

  const workstations = Arr.findFirst(
    coworkOfferings(context.offerings),
    (offering) => offering.tier === "reserved-desk"
  ).pipe(
    Option.flatMap((offering) =>
      Arr.findFirst(offering.addOns, (addOn) => addOn.id === "workstation")
    ),
    Option.flatMap((addOn) => Option.fromNullishOr(addOn.options)),
    Option.getOrElse(() => [])
  );
  const unavailableWorkstations = new Set(
    Option.match(workstationRequirement, {
      onNone: () => [],
      onSome: (availability) => availability.unavailableMonitorOptions,
    })
  );
  const workstationRequired =
    isReservedDesk &&
    Option.exists(workstationRequirement, (availability) =>
      Option.exists(draft.date, (date) =>
        availability.reservedDeskWorkstationRequiredDates.includes(date)
      )
    );
  const requiredWorkstation = workstationRequired
    ? Arr.findFirst(
        workstations,
        ({ id }) => !unavailableWorkstations.has(id)
      ).pipe(Option.map(({ id }) => id))
    : Option.none();

  const openSpaceClosedToday = isOpenSpaceClosedToday(context.now);
  const chosenWorkstation = Option.map(
    Option.filter(draft.workstation, () => isReservedDesk),
    ({ option }) => option
  );

  const blockers: Array<CoworkBlocker> = [];
  if (Option.isNone(draft.date)) blockers.push(CoworkBlocker.DateRequired());
  if (
    Option.isNone(range) ||
    (Option.isSome(draft.date) &&
      (Option.isNone(selection) ||
        (isReservedDesk && Option.isNone(workstationRequirement))))
  ) {
    blockers.push(CoworkBlocker.AvailabilityPending());
  }
  if (Option.exists(draft.date, (date) => date < earliest || date > latest)) {
    blockers.push(CoworkBlocker.DateOutOfRange());
  }
  if (
    draft.tier === "open-space" &&
    Option.contains(draft.date, today) &&
    openSpaceClosedToday
  ) {
    blockers.push(CoworkBlocker.OpenSpaceClosedToday());
  }
  if (
    Option.exists(draft.date, (date) =>
      Option.exists(
        selection,
        (availability) =>
          !isOfferAvailable(availability, { date, tier: draft.tier })
      )
    )
  ) {
    blockers.push(CoworkBlocker.OfferUnavailable());
  }
  if (
    Option.exists(chosenWorkstation, (id) => unavailableWorkstations.has(id))
  ) {
    blockers.push(CoworkBlocker.WorkstationUnavailable());
  } else if (workstationRequired && Option.isNone(chosenWorkstation)) {
    blockers.push(CoworkBlocker.WorkstationRequired());
  }

  return {
    dates: {
      earliest,
      latest,
      unavailable: new Set(
        Option.match(range, {
          onNone: () => [],
          onSome: (availability) =>
            availability.unavailableDates.filter(
              (date) =>
                !isOfferAvailable(availability, { date, tier: draft.tier })
            ),
        })
      ),
    },
    unavailableTiers: new Set(
      Option.orElse(selection, () => range).pipe(
        Option.match({
          onNone: () => [],
          onSome: (availability) => availability.unavailableCoworkTiers,
        })
      )
    ),
    openSpaceClosedToday,
    workstations,
    unavailableWorkstations,
    requiredWorkstation,
    workstationRequired,
    notices: Option.match(selection, {
      onNone: () => [],
      onSome: (availability) =>
        availability.notices.filter((notice) =>
          Option.contains(draft.date, notice.date)
        ),
    }),
    blockers,
  };
};

/**
 * The draft with its Reserved Desk workstation fitted to settled
 * availability: a date that requires a workstation adds the first free one,
 * or replaces a taken choice keeping its origin. Once the date stops
 * requiring one, only a workstation the screen added is removed; the
 * customer's own choice stays. Unchanged until the date's queries settle.
 */
export const normalizeCoworkWorkstation = (
  draft: CoworkDraft,
  availability: CoworkAvailability,
  enablement: CoworkEnablement
): CoworkDraft => {
  const settled =
    draft.tier === "reserved-desk" &&
    Option.isSome(draft.date) &&
    Option.isSome(availability.selection) &&
    Option.isSome(availability.workstationRequirement);
  if (!settled) return draft;

  return Option.match(enablement.requiredWorkstation, {
    onSome: (required) =>
      Option.match(draft.workstation, {
        onNone: () => ({
          ...draft,
          workstation: Option.some({
            option: required,
            origin: "requirement" as const,
          }),
        }),
        onSome: (current) =>
          enablement.unavailableWorkstations.has(current.option)
            ? {
                ...draft,
                workstation: Option.some({ ...current, option: required }),
              }
            : draft,
      }),
    onNone: () =>
      Option.exists(draft.workstation, ({ origin }) => origin === "requirement")
        ? { ...draft, workstation: Option.none() }
        : draft,
  });
};

/**
 * Why a day the calendar shows full is full for the drafted tier, read for
 * that day alone: whether another tier the catalog offers is still free.
 */
export const freeCoworkTierOn = (
  day: CustomerAvailability,
  offerings: ReadonlyArray<CustomerOffering>,
  fullTier: CustomerBookableCoworkTier
): Option.Option<CoworkOffering> =>
  Arr.findFirst(
    coworkOfferings(offerings),
    ({ tier }) =>
      tier !== fullTier && !day.unavailableCoworkTiers.includes(tier)
  );
