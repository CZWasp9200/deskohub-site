import type { CustomerOfficePeople } from "@deskohub/workspace-customer-api";
import { Data, Option } from "effect";
import { isEmailAddress } from "../../auth/email-address";

/**
 * Who is coming to a private office: the customer ("You") while
 * `contactAttends`, and the people added by email address, in added order.
 * The Workspace checks the list at checkout; the screen only keeps it.
 */
export type OfficePeople = CustomerOfficePeople;

/** The list an office booking opens with, and a rebooked office too: You only. */
export const youOnly: OfficePeople = { contactAttends: true, invitees: [] };

/** One seat per person. */
export const officePeopleCount = ({
  contactAttends,
  invitees,
}: OfficePeople): number => invitees.length + (contactAttends ? 1 : 0);

/** An address as the invitation goes to it: trimmed and lower-cased. */
const addressOf = (typed: string) => typed.trim().toLocaleLowerCase("en-US");

/** What adding a typed address did to the list. */
export type OfficePersonAddition = Data.TaggedEnum<{
  /** The list with the person added, or You back on it for the customer's own address. */
  Added: { readonly people: OfficePeople };
  /** Already on the list: the list stays as it was. */
  Listed: Record<never, never>;
  /** Not a whole email address. */
  Invalid: Record<never, never>;
  /** Every seat is taken. */
  Full: Record<never, never>;
}>;
export const OfficePersonAddition = Data.taggedEnum<OfficePersonAddition>();

/** Whether one more person fits; always while the capacity can't be read. */
export const canAddOfficePerson = (
  people: OfficePeople,
  maximumSeats: Option.Option<number>
): boolean =>
  Option.match(maximumSeats, {
    onNone: () => true,
    onSome: (most) => officePeopleCount(people) < most,
  });

/**
 * Adds the typed address. The customer's own address (`contactEmail`) puts
 * You back on the list instead of inviting them.
 */
export const addOfficePerson = (
  people: OfficePeople,
  typed: string,
  context: {
    readonly contactEmail: Option.Option<string>;
    readonly maximumSeats: Option.Option<number>;
  }
): OfficePersonAddition => {
  const address = addressOf(typed);
  if (!isEmailAddress(address)) return OfficePersonAddition.Invalid();
  const isContact = Option.exists(
    context.contactEmail,
    (email) => addressOf(email) === address
  );
  if (
    isContact
      ? people.contactAttends
      : people.invitees.some((invitee) => addressOf(invitee) === address)
  ) {
    return OfficePersonAddition.Listed();
  }
  if (!canAddOfficePerson(people, context.maximumSeats)) {
    return OfficePersonAddition.Full();
  }
  return OfficePersonAddition.Added({
    people: isContact
      ? { ...people, contactAttends: true }
      : { ...people, invitees: [...people.invitees, address] },
  });
};

/** Whether a person can be taken off: someone must stay on the list. */
export const canRemoveOfficePerson = (people: OfficePeople): boolean =>
  officePeopleCount(people) > 1;

/** The list without You, while someone else stays on it. */
export const removeYou = (people: OfficePeople): OfficePeople =>
  canRemoveOfficePerson(people) ? { ...people, contactAttends: false } : people;

/** The list with You back on it, when a seat is free. */
export const addYou = (
  people: OfficePeople,
  maximumSeats: Option.Option<number>
): OfficePeople =>
  people.contactAttends || !canAddOfficePerson(people, maximumSeats)
    ? people
    : { ...people, contactAttends: true };

/** The list without the invited address, while someone else stays on it. */
export const removeInvitee = (
  people: OfficePeople,
  email: string
): OfficePeople =>
  canRemoveOfficePerson(people)
    ? {
        ...people,
        invitees: people.invitees.filter((invitee) => invitee !== email),
      }
    : people;
