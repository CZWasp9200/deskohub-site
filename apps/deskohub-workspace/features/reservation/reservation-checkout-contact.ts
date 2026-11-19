import { Result, Schema } from "effect";
import {
  getOfficePeopleSeats,
  officePeopleSchema,
  validateOfficePeople,
} from "@/features/office/office-people";
import { officeSeatsSchema } from "./office-reservation";
import { reservationBillingSelectionSchema } from "./reservation-billing";
import { reservationCustomerSchema } from "./reservation-contact";

/**
 * The reservation page query parameter that carries the sealed contact
 * details a signed-out customer typed before verifying the email.
 */
export const checkoutContactQueryParam = "contact";

/**
 * What a signed-out customer types at the contact-details step, phone read in
 * `defaultPhoneRegion` (the visitor locale's, `defaultPhoneRegion(locale)`).
 * It rides on the sign-in's return path, so the reservation page the sign-in
 * lands on can save the profile and continue the checkout.
 */
export const reservationCheckoutContactSchema = (defaultPhoneRegion: string) =>
  Schema.Struct({
    ...reservationCustomerSchema(defaultPhoneRegion).fields,
    billing: reservationBillingSelectionSchema,
    marketingConsent: Schema.Boolean,
  });

export type ReservationCheckoutContact = ReturnType<
  typeof reservationCheckoutContactSchema
>["Type"];

/** The office selection that must survive the email check. */
export const checkoutOfficeSelectionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("people"), people: officePeopleSchema }),
  Schema.Struct({ kind: Schema.Literal("seats"), seats: officeSeatsSchema }),
]);
export type CheckoutOfficeSelection = typeof checkoutOfficeSelectionSchema.Type;

const officePeopleEqual = Schema.toEquivalence(officePeopleSchema);

/** Whether a verified draft still names exactly the attendees of the held office. */
export const matchesHeldOfficeSelection = (
  held: CheckoutOfficeSelection,
  draft: CheckoutOfficeSelection,
  context: { readonly seats: number; readonly contactEmail?: string }
): boolean => {
  if (held.kind === "seats") {
    return (
      draft.kind === "seats" &&
      draft.seats === held.seats &&
      held.seats === context.seats
    );
  }
  if (draft.kind !== "people") return false;

  const checked = validateOfficePeople(draft.people, {
    seatCapacity: context.seats,
    contactEmail: context.contactEmail,
  });
  return (
    Result.isSuccess(checked) &&
    getOfficePeopleSeats(checked.success) === context.seats &&
    officePeopleEqual(held.people, checked.success)
  );
};
