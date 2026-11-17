import type {
  CustomerBookableDates,
  CustomerBookedSelection,
  CustomerBookingSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { bookingPreselectionKey } from "../booking-preselection";
import {
  type CoworkAvailability,
  type CoworkDraft,
  type CoworkEnablement,
  type CoworkOvernightStay,
  coworkDraftFromSelection,
  coworkEnablement,
  coworkOvernightStay,
  defaultCoworkDraft,
  fitCoworkStay,
  normalizeCoworkWorkstation,
  toCoworkSelection,
} from "../selection/cowork-selection";
import { quotableSelection } from "./booking-family-view";

/** A draft the screen keeps, with the preselection it grew from. */
export interface KeptCoworkDraft {
  /** The preselection's key (`bookingPreselectionKey`); empty without one. */
  readonly seed: string;
  readonly draft: CoworkDraft;
}

/**
 * The draft the cowork screen shows: the one it keeps, unless the screen
 * was opened on another preselection ("Book again"), which then replaces
 * it; else the preselection's draft, else the empty default. Without a
 * preselection the kept draft stays, so a restarted checkout comes back to
 * the customer's choices. An overnight stay the catalog no longer
 * advertises opens as a day.
 */
export const openingCoworkDraft = ({
  kept,
  preselection,
  offerings,
}: {
  readonly kept: Option.Option<KeptCoworkDraft>;
  readonly preselection: Option.Option<CustomerBookedSelection>;
  readonly offerings: ReadonlyArray<CustomerOffering>;
}): CoworkDraft => {
  const seed = bookingPreselectionKey(preselection);
  return Option.filter(
    kept,
    (draft) => seed === "" || draft.seed === seed
  ).pipe(
    Option.map(({ draft }) => draft),
    Option.orElse(() =>
      Option.flatMap(preselection, ({ selection }) =>
        coworkDraftFromSelection(selection, offerings)
      )
    ),
    Option.getOrElse(() => defaultCoworkDraft(offerings)),
    (draft) => fitCoworkStay(draft, offerings)
  );
};

/** What the cowork screen shows for its draft and the availability read. */
export type CoworkBookingModel = {
  /**
   * The draft with its workstation fitted to the availability; the screen
   * keeps it once it differs from the one it holds.
   */
  readonly draft: CoworkDraft;
  readonly enablement: CoworkEnablement;
  /**
   * The overnight stay a Reserved Desk draft can switch to, from the
   * catalog; none hides the Day / Overnight switch.
   */
  readonly overnightStay: Option.Option<CoworkOvernightStay>;
  /** The booking the draft names, once it has a date. */
  readonly selection: Option.Option<CustomerBookingSelection>;
  /** The selection to quote, while it may still be bookable. */
  readonly quotable: Option.Option<CustomerBookingSelection>;
};

export const coworkBookingModel = ({
  draft,
  now,
  offerings,
  bookableDates,
  availability,
}: {
  readonly draft: CoworkDraft;
  readonly now: Date;
  readonly offerings: ReadonlyArray<CustomerOffering>;
  /** The drafted tier's bookable dates (`coworkBookableDates`). */
  readonly bookableDates: CustomerBookableDates;
  /** Settled reads of `coworkAvailabilityQueries(draft, bookableDates)`. */
  readonly availability: CoworkAvailability;
}): CoworkBookingModel => {
  const context = { now, offerings, bookableDates, availability };
  const read = coworkEnablement(draft, context);
  const fitted = normalizeCoworkWorkstation(draft, availability, read);
  // A fitted workstation changes the selection, whose availability the
  // screen reads next; until then the offer counts as loading.
  const enablement =
    fitted === draft
      ? read
      : coworkEnablement(fitted, {
          ...context,
          availability: { ...availability, selection: Option.none() },
        });
  const selection = toCoworkSelection(fitted);
  return {
    draft: fitted,
    enablement,
    overnightStay: Option.filter(
      coworkOvernightStay(offerings),
      () => fitted.tier === "reserved-desk"
    ),
    selection,
    quotable: quotableSelection(selection, enablement.blockers),
  };
};
