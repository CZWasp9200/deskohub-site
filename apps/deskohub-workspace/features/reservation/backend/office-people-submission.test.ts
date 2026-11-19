import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import {
  type ReservationOrderData,
  reservationOrderSchema,
} from "@/features/reservation/reservation-order";
import { validateSubmittedOfficePeople } from "./office-people-submission";

const officeDay = Temporal.Now.plainDateISO().add({ days: 7 }).toString();
const contact = {
  name: "Synthetic Booker",
  email: testEmailAddress("office-booker"),
  phone: "+420 777 000 000",
};
const decodeReservation = <T>(input: T) =>
  Effect.runSync(
    Schema.decodeUnknownEffect(reservationOrderSchema("CZ"))(input)
  );

const office = (seats: number) =>
  decodeReservation({
    kind: "office",
    ...contact,
    startsOn: officeDay,
    endsOn: officeDay,
    seats,
  });

const rejection = (
  people: Parameters<typeof validateSubmittedOfficePeople>[0],
  reservation: ReservationOrderData
) =>
  Effect.runSync(
    validateSubmittedOfficePeople(people, reservation).pipe(
      Effect.flip,
      Effect.map((error) => error.rejection._tag)
    )
  );

describe("validateSubmittedOfficePeople", () => {
  test("books seats alone when no people list is sent", () => {
    expect(
      Effect.runSync(validateSubmittedOfficePeople(undefined, office(3)))
    ).toBeUndefined();
  });

  test("returns the normalized list when its head count is the seats", () => {
    const invitee = testEmailAddress("office-invitee");
    expect(
      Effect.runSync(
        validateSubmittedOfficePeople(
          { contactAttends: true, invitees: [` ${invitee.toUpperCase()} `] },
          office(2)
        )
      )
    ).toEqual({ contactAttends: true, invitees: [invitee] });
  });

  test("rejects a list whose head count isn't the seats", () => {
    expect(
      rejection(
        {
          contactAttends: false,
          invitees: [testEmailAddress("office-invitee")],
        },
        office(2)
      )
    ).toBe("SeatsMismatch");
    expect(
      rejection(
        {
          contactAttends: true,
          invitees: [testEmailAddress("office-invitee")],
        },
        office(1)
      )
    ).toBe("OverCapacity");
  });

  test("rejects the contact's own address as an invitee", () => {
    expect(
      rejection(
        {
          contactAttends: false,
          invitees: [testEmailAddress("office-booker")],
        },
        office(1)
      )
    ).toBe("InviteeRejected");
  });

  test("rejects a people list on a reservation that isn't an office", () => {
    expect(
      rejection(
        { contactAttends: true, invitees: [] },
        decodeReservation({
          kind: "cowork",
          ...contact,
          date: officeDay,
          entryTier: "basic",
          coffee: false,
        })
      )
    ).toBe("NotOffice");
  });
});
