import type {
  CustomerAccountState,
  CustomerAvailability,
  CustomerBookableDates,
  CustomerBookedSelection,
  CustomerBookingSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { bookingPreselectionKey } from "../booking-preselection";
import { detailsAccess } from "../checkout-screen/details-form";
import {
  canAddOfficePerson,
  officePeopleCount,
} from "../selection/office-people";
import {
  clampOfficeDraft,
  emptyOfficeDraft,
  type OfficeDraft,
  type OfficeEnablement,
  type OfficeOffering,
  officeDraftFromSelection,
  officeEnablement,
  officeLastDate,
  toOfficeSelection,
} from "../selection/office-selection";
import type { PragueDate } from "../selection/prague-date";
import {
  discountLine,
  type PriceBreakdown,
  type PriceLine,
} from "../ui/price-breakdown";
import { quotableSelection } from "./booking-family-view";

/** The office offering of the catalog, when offices are offered. */
export const officeOfferingOf = (
  offerings: ReadonlyArray<CustomerOffering>
): Option.Option<OfficeOffering> =>
  Option.fromNullishOr(
    offerings.find(
      (offering): offering is OfficeOffering => offering.family === "office"
    )
  );

/** A draft the screen keeps, with the preselection it grew from. */
export interface KeptOfficeDraft {
  /** The preselection's key (`bookingPreselectionKey`); empty without one. */
  readonly seed: string;
  readonly draft: OfficeDraft;
}

/**
 * The draft the office screen shows: the one it keeps, unless the screen
 * was opened on another preselection ("Book again"), which then replaces
 * it; else the preselection's draft, else the empty one. Without a
 * preselection the kept draft stays, so a restarted checkout comes back to
 * the customer's days and people.
 */
export const openingOfficeDraft = ({
  kept,
  preselection,
  bookableDates,
}: {
  readonly kept: Option.Option<KeptOfficeDraft>;
  readonly preselection: Option.Option<CustomerBookedSelection>;
  /** The office offering's bookable dates. */
  readonly bookableDates: CustomerBookableDates;
}): OfficeDraft => {
  const seed = bookingPreselectionKey(preselection);
  return Option.filter(
    kept,
    (draft) => seed === "" || draft.seed === seed
  ).pipe(
    Option.map(({ draft }) => draft),
    Option.orElse(() =>
      Option.flatMap(preselection, ({ selection }) =>
        officeDraftFromSelection(selection, bookableDates)
      )
    ),
    Option.getOrElse(() => emptyOfficeDraft)
  );
};

/**
 * The days stepper and the people list, once a first day is picked: how far
 * the days go, the stay's last day, and how many of the office's seats the
 * people take.
 */
export type OfficeSteppers = {
  readonly days: {
    /** The most days the first day allows. */
    readonly maximum: number;
    /** The stay's last day, which the row names. */
    readonly lastDate: PragueDate;
  };
  readonly people: {
    /** People on the list, one seat each. */
    readonly count: number;
    /** The office's seats; none while its capacity can't be read. */
    readonly maximum: Option.Option<number>;
    /** Every seat is taken: no one more can be added. */
    readonly full: boolean;
  };
};

/** What the office screen shows for its draft and the availability read. */
export type OfficeBookingModel = {
  /** The draft with its days within what the first day allows. */
  readonly draft: OfficeDraft;
  readonly enablement: OfficeEnablement;
  /** The booking the draft names, once it has a first day. */
  readonly selection: Option.Option<CustomerBookingSelection>;
  readonly quotable: Option.Option<CustomerBookingSelection>;
  /** None until a first day the office can be booked from is picked. */
  readonly steppers: Option.Option<OfficeSteppers>;
};

export const officeBookingModel = ({
  draft,
  offering,
  availability,
}: {
  readonly draft: OfficeDraft;
  readonly offering: OfficeOffering;
  /** Settled read of `officeAvailabilityQuery(offering.bookableDates)`. */
  readonly availability: Option.Option<CustomerAvailability>;
}): OfficeBookingModel => {
  const context = { offering, availability };
  const fitted = clampOfficeDraft(draft, officeEnablement(draft, context));
  const enablement = officeEnablement(fitted, context);
  const selection = toOfficeSelection(fitted);
  return {
    draft: fitted,
    enablement,
    selection,
    quotable: quotableSelection(selection, enablement.blockers),
    steppers: Option.flatMap(fitted.date, (date) =>
      enablement.maximumDayCount === 0
        ? Option.none()
        : Option.some({
            days: {
              maximum: enablement.maximumDayCount,
              lastDate: officeLastDate(date, fitted.dayCount),
            },
            people: {
              count: officePeopleCount(fitted.people),
              maximum: enablement.maximumSeats,
              full: !canAddOfficePerson(fitted.people, enablement.maximumSeats),
            },
          })
    ),
  };
};

/**
 * The sale discounts the office's from-price includes, as its lines: none
 * without a sale, and absent when the catalog doesn't list a running sale's
 * discounts or they don't make up its discount, so the lines always add up.
 */
const saleLines = ({
  advertisedPrice: { discount, discounts = [] },
}: OfficeOffering): Option.Option<ReadonlyArray<PriceLine>> =>
  discounts.reduce((sum, { amount }) => sum + amount.value, 0) ===
  discount.value
    ? Option.some(discounts.map((sale) => discountLine("office", sale)))
    : Option.none();

/**
 * The office's from-price as the lines it adds up from: a day's access and
 * one seat for that day at its daily rate, as the catalog prices them, then
 * any running sale's discounts, totalling the advertised price of one day
 * with one seat. None while a sale's discounts are not listed. It is no
 * quote, so it never shows the tax note a VAT payer's quoted total carries:
 * the catalog has no VAT status, and only a quote's summary gives one.
 */
export const officeFromPrice = (
  offering: OfficeOffering
): Option.Option<PriceBreakdown> =>
  Option.map(saleLines(offering), (sale) => ({
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
      ...sale,
    ],
    total: offering.advertisedPrice.price,
    vatStatus: "not-vat-payer",
  }));

/** The signed-in customer, as the people list's You row shows them. */
export interface OfficeContact {
  readonly email: string;
  readonly name?: string;
}

/**
 * The signed-in customer as the people list's You row shows them: the
 * account's email and, once the profile has one, its name. None for an
 * account that can't book.
 */
export const officeContactOf = (
  account: CustomerAccountState
): Option.Option<OfficeContact> => {
  const access = detailsAccess(account);
  return access._tag === "Ready"
    ? Option.some({
        email: access.self.email,
        ...Option.match(access.self.name, {
          onNone: () => ({}),
          onSome: (name) => ({ name }),
        }),
      })
    : Option.none();
};
