import { Result } from "effect";
import {
  canAddOfficePerson,
  checkInviteeEmail,
  getOfficePeopleSeats,
  InviteeEmail,
  type InviteeEmailRejection,
  type OfficePeople,
} from "@/features/office/office-people";

/** A new office booking: only the contact, the "You" row, is coming. */
export const initialOfficePeople: OfficePeople = {
  contactAttends: true,
  invitees: [],
};

/** Why the booking form can't add an address: it is rejected, or the office is full. */
export type OfficeInviteeAdditionRejection = InviteeEmailRejection | "full";

/**
 * Adds one typed address to the end of the list, trimmed and lower-cased.
 * `contactEmail` is the contact's address once the form knows it.
 */
export const addOfficeInvitee = (
  people: OfficePeople,
  candidate: string,
  context: { readonly seatCapacity: number; readonly contactEmail?: string }
): Result.Result<OfficePeople, OfficeInviteeAdditionRejection> => {
  if (!canAddOfficePerson(people, context.seatCapacity)) {
    return Result.fail("full");
  }
  return Result.map(
    checkInviteeEmail(candidate, {
      invitees: people.invitees.map((invitee) => InviteeEmail.make(invitee)),
      contactEmail: context.contactEmail,
    }),
    (invitee) => ({ ...people, invitees: [...people.invitees, invitee] })
  );
};

export const removeOfficeInvitee = (
  people: OfficePeople,
  invitee: string
): OfficePeople => ({
  ...people,
  invitees: people.invitees.filter((email) => email !== invitee),
});

/** The contact stays the booker and keeps their emails; they only take no seat. */
export const removeOfficeContact = (people: OfficePeople): OfficePeople => ({
  ...people,
  contactAttends: false,
});

export const restoreOfficeContact = (people: OfficePeople): OfficePeople => ({
  ...people,
  contactAttends: true,
});

/** At least one person must stay on the list. */
export const canRemoveOfficePerson = (people: OfficePeople) =>
  getOfficePeopleSeats(people) > 1;
