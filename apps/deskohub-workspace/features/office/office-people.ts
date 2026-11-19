import { Data, Option, Result, Schema } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";

/**
 * Who is coming to a private office, as the booking form and the customer
 * API submit it: the reservation's contact (the "You" row) while they attend,
 * and the people added by email address. Each person takes one seat, so the
 * office's `seats` is derived from this list, never chosen beside it.
 */
export const officePeopleSchema = Schema.Struct({
  contactAttends: Schema.Boolean,
  invitees: Schema.Array(Schema.String),
}).annotate({
  identifier: "OfficePeople",
  description:
    "Who is coming to a private office: the contact, and the people added by email address.",
});
export type OfficePeople = typeof officePeopleSchema.Type;

/** An invited person's email address, trimmed and lower-cased. */
export const InviteeEmail = Schema.String.pipe(
  Schema.brand("InviteeEmail")
).annotate({
  identifier: "InviteeEmail",
  description:
    "An email address a private office booker added, trimmed and lower-cased.",
});
export type InviteeEmail = typeof InviteeEmail.Type;

/** `OfficePeople` whose invitees passed `validateOfficePeople`. */
export type ValidOfficePeople = {
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<InviteeEmail>;
};

/**
 * Why an invitee's address can't be added: it isn't an email address, it is
 * already on the list, or it is the contact's own address, which belongs on
 * the "You" row instead.
 */
export type InviteeEmailRejection = "invalid" | "duplicate" | "contact";

export type OfficePeopleIssue = Data.TaggedEnum<{
  /** Neither the contact nor anyone else is coming. */
  NoPeople: Record<never, never>;
  /** More people than the office has seats. */
  OverCapacity: { readonly seatCapacity: number };
  /** The invitee at `index` (in submitted order) can't be added. */
  InviteeRejected: {
    readonly index: number;
    readonly reason: InviteeEmailRejection;
  };
}>;
export const OfficePeopleIssue = Data.taggedEnum<OfficePeopleIssue>();

type PeopleCount = {
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<unknown>;
};

/** The seats a list of people takes: one per person. */
export const getOfficePeopleSeats = ({
  contactAttends,
  invitees,
}: PeopleCount) => invitees.length + (contactAttends ? 1 : 0);

/** Whether one more person still fits in an office of `seatCapacity` seats. */
export const canAddOfficePerson = (people: PeopleCount, seatCapacity: number) =>
  getOfficePeopleSeats(people) < seatCapacity;

/**
 * Checks one address before it joins `invitees`. `contactEmail` is the
 * contact's address once known; a signed-out website booker enters it only
 * at the contact step, so the server checks the whole list again with it.
 */
export const checkInviteeEmail = (
  candidate: string,
  context: {
    readonly invitees: ReadonlyArray<InviteeEmail>;
    readonly contactEmail?: string;
  }
): Result.Result<InviteeEmail, InviteeEmailRejection> => {
  const decoded = decodeEmail(candidate);
  if (Result.isFailure(decoded)) return Result.fail("invalid");

  const email = InviteeEmail.make(decoded.success.toLowerCase());
  if (context.invitees.includes(email)) return Result.fail("duplicate");
  if (
    context.contactEmail !== undefined &&
    context.contactEmail.trim().toLowerCase() === email
  ) {
    return Result.fail("contact");
  }
  return Result.succeed(email);
};

/**
 * Checks a submitted list: every invitee in order, then that at least one
 * person is coming and that everyone fits in the office.
 */
export const validateOfficePeople = (
  people: OfficePeople,
  context: { readonly seatCapacity: number; readonly contactEmail?: string }
): Result.Result<ValidOfficePeople, OfficePeopleIssue> => {
  const invitees: InviteeEmail[] = [];
  for (const [index, candidate] of people.invitees.entries()) {
    const checked = checkInviteeEmail(candidate, {
      invitees,
      contactEmail: context.contactEmail,
    });
    if (Result.isFailure(checked)) {
      return Result.fail(
        OfficePeopleIssue.InviteeRejected({ index, reason: checked.failure })
      );
    }
    invitees.push(checked.success);
  }

  const valid = { contactAttends: people.contactAttends, invitees };
  const seats = getOfficePeopleSeats(valid);
  if (seats === 0) return Result.fail(OfficePeopleIssue.NoPeople());
  if (seats > context.seatCapacity) {
    return Result.fail(
      OfficePeopleIssue.OverCapacity({ seatCapacity: context.seatCapacity })
    );
  }
  return Result.succeed(valid);
};

/**
 * Who is coming to a booked office, as its booker sees them: the stored
 * `contactAttends` and the invitees in order. None for an office booked
 * without a people list (`contactAttends` null), and none once the retention
 * purge reduced or deleted any invitee, which shows as a missing address or
 * as fewer people than the booked `seats`.
 */
export const getBookedOfficePeople = <
  Invitee extends { readonly email: InviteeEmail | null },
>(booking: {
  readonly contactAttends: boolean | null;
  readonly seats: number;
  readonly invitees: ReadonlyArray<Invitee>;
}): Option.Option<{
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<Invitee & { readonly email: InviteeEmail }>;
}> => {
  const { contactAttends, seats } = booking;
  if (contactAttends === null) return Option.none();
  const invitees = booking.invitees.filter(
    (invitee): invitee is Invitee & { readonly email: InviteeEmail } =>
      invitee.email !== null
  );
  return invitees.length === booking.invitees.length &&
    getOfficePeopleSeats({ contactAttends, invitees }) === seats
    ? Option.some({ contactAttends, invitees })
    : Option.none();
};

const decodeEmail = Schema.decodeUnknownResult(reservationCustomerEmailSchema);
