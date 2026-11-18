import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Result } from "effect";
import {
  canAddOfficePerson,
  checkInviteeEmail,
  getOfficePeopleSeats,
  InviteeEmail,
  OfficePeopleIssue,
  validateOfficePeople,
} from "./office-people";

const contactEmail = testEmailAddress("office-contact");
const jana = testEmailAddress("office-jana");
const petr = testEmailAddress("office-petr");

// Capacities other than the live office's, so a hard-coded maximum fails.
const seatCapacity = 4;

describe("getOfficePeopleSeats", () => {
  test("counts the contact only while they attend", () => {
    expect(getOfficePeopleSeats({ contactAttends: true, invitees: [] })).toBe(
      1
    );
    expect(
      getOfficePeopleSeats({ contactAttends: true, invitees: [jana, petr] })
    ).toBe(3);
    expect(
      getOfficePeopleSeats({ contactAttends: false, invitees: [jana, petr] })
    ).toBe(2);
  });
});

describe("canAddOfficePerson", () => {
  test("allows another person until the office capacity is reached", () => {
    expect(
      canAddOfficePerson({ contactAttends: true, invitees: [jana] }, 3)
    ).toBe(true);
    expect(
      canAddOfficePerson({ contactAttends: true, invitees: [jana, petr] }, 3)
    ).toBe(false);
    expect(
      canAddOfficePerson({ contactAttends: false, invitees: [jana, petr] }, 3)
    ).toBe(true);
  });
});

describe("checkInviteeEmail", () => {
  test("trims and lower-cases an accepted address", () => {
    const result = checkInviteeEmail(`  ${jana.toUpperCase()} `, {
      invitees: [],
    });

    expect(result).toEqual(Result.succeed(InviteeEmail.make(jana)));
  });

  test("rejects an address that isn't an email address", () => {
    expect(checkInviteeEmail("jana.novak", { invitees: [] })).toEqual(
      Result.fail("invalid")
    );
    expect(checkInviteeEmail("   ", { invitees: [] })).toEqual(
      Result.fail("invalid")
    );
  });

  test("rejects an address already on the list, whatever its case", () => {
    expect(
      checkInviteeEmail(jana.toUpperCase(), {
        invitees: [InviteeEmail.make(jana)],
      })
    ).toEqual(Result.fail("duplicate"));
  });

  test("rejects the contact's own address", () => {
    expect(
      checkInviteeEmail(contactEmail, {
        invitees: [],
        contactEmail: ` ${contactEmail.toUpperCase()}`,
      })
    ).toEqual(Result.fail("contact"));
  });

  test("accepts any valid address while the contact is unknown", () => {
    expect(
      Result.isSuccess(checkInviteeEmail(contactEmail, { invitees: [] }))
    ).toBe(true);
  });
});

describe("validateOfficePeople", () => {
  test("normalizes the invitees and keeps their order", () => {
    const result = validateOfficePeople(
      { contactAttends: false, invitees: [` ${petr.toUpperCase()}`, jana] },
      { seatCapacity, contactEmail }
    );

    expect(result).toEqual(
      Result.succeed({
        contactAttends: false,
        invitees: [InviteeEmail.make(petr), InviteeEmail.make(jana)],
      })
    );
  });

  test("accepts the contact alone", () => {
    expect(
      Result.isSuccess(
        validateOfficePeople(
          { contactAttends: true, invitees: [] },
          { seatCapacity: 1 }
        )
      )
    ).toBe(true);
  });

  test("needs at least one person", () => {
    expect(
      validateOfficePeople(
        { contactAttends: false, invitees: [] },
        { seatCapacity }
      )
    ).toEqual(Result.fail(OfficePeopleIssue.NoPeople()));
  });

  test("refuses more people than the office capacity", () => {
    expect(
      validateOfficePeople(
        { contactAttends: true, invitees: [jana, petr] },
        { seatCapacity: 2 }
      )
    ).toEqual(Result.fail(OfficePeopleIssue.OverCapacity({ seatCapacity: 2 })));
    expect(
      Result.isSuccess(
        validateOfficePeople(
          { contactAttends: false, invitees: [jana, petr] },
          { seatCapacity: 2 }
        )
      )
    ).toBe(true);
  });

  test("names the first rejected invitee by position", () => {
    expect(
      validateOfficePeople(
        { contactAttends: true, invitees: [jana, "not-an-address", petr] },
        { seatCapacity }
      )
    ).toEqual(
      Result.fail(
        OfficePeopleIssue.InviteeRejected({ index: 1, reason: "invalid" })
      )
    );
  });

  test("rejects a repeated invitee and the contact's own address", () => {
    expect(
      validateOfficePeople(
        { contactAttends: true, invitees: [jana, jana.toUpperCase()] },
        { seatCapacity }
      )
    ).toEqual(
      Result.fail(
        OfficePeopleIssue.InviteeRejected({ index: 1, reason: "duplicate" })
      )
    );
    expect(
      validateOfficePeople(
        { contactAttends: false, invitees: [jana, contactEmail] },
        { seatCapacity, contactEmail }
      )
    ).toEqual(
      Result.fail(
        OfficePeopleIssue.InviteeRejected({ index: 1, reason: "contact" })
      )
    );
  });
});
