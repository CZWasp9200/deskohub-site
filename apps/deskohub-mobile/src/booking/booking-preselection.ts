import {
  type CustomerBookedSelection,
  CustomerBookingSelectionQuery,
  type CustomerReservationFamily,
} from "@deskohub/workspace-customer-api";
import { Option, Schema } from "effect";

type RouteParams = Readonly<
  Record<string, string | ReadonlyArray<string> | undefined>
>;

/**
 * The family screen's route opened on a booked selection ("Book again"):
 * the selection's fields as the customer API's selection query carries them,
 * the family in the path, and early setup beside them.
 */
export const bookAgainHref = ({
  selection: { family, ...fields },
  earlySetup,
}: CustomerBookedSelection) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...fields, earlySetup })) {
    if (value !== undefined) query.set(key, String(value));
  }
  return `/book/${family}?${query.toString()}` as const;
};

const decodeQuery = Schema.decodeUnknownOption(CustomerBookingSelectionQuery);

const single = (value: string | ReadonlyArray<string> | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * The selection a family screen was opened with; none without one, or when
 * the route params don't name a selection of that family, so the screen
 * starts empty.
 */
export const bookingPreselectionOf = (
  family: CustomerReservationFamily,
  params: RouteParams
): Option.Option<CustomerBookedSelection> => {
  const fields = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      const text = single(value);
      return text === undefined || key === "restart" || key === "earlySetup"
        ? []
        : [[key, text]];
    })
  );
  const earlySetup = single(params.earlySetup);
  return Option.map(
    decodeQuery({ ...fields, family }),
    ({ coffee, ...selection }): CustomerBookedSelection => ({
      selection: {
        ...selection,
        ...(coffee === undefined ? {} : { coffee: coffee === "true" }),
      },
      ...(earlySetup === "true" || earlySetup === "false"
        ? { earlySetup: earlySetup === "true" }
        : {}),
    })
  );
};

/**
 * Tells preselections apart, early setup included; empty when the screen
 * opened without one.
 */
export const bookingPreselectionKey = (
  preselection: Option.Option<CustomerBookedSelection>
) =>
  Option.match(preselection, {
    onNone: () => "",
    onSome: ({ selection, earlySetup }) =>
      JSON.stringify([selection, earlySetup ?? null]),
  });
