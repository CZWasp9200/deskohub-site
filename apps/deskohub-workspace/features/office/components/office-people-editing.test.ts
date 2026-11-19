import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Result } from "effect";
import {
  addOfficeInvitee,
  canRemoveOfficePerson,
  initialOfficePeople,
  removeOfficeContact,
  removeOfficeInvitee,
  restoreOfficeContact,
} from "./office-people-editing";

const contactEmail = testEmailAddress("office-editing-contact");
const jana = testEmailAddress("office-editing-jana");
const petr = testEmailAddress("office-editing-petr");

describe("initialOfficePeople", () => {
  test("starts with only the contact coming", () => {
    expect(initialOfficePeople).toEqual({
      contactAttends: true,
      invitees: [],
    });
  });
});

describe("addOfficeInvitee", () => {
  test("appends the trimmed, lower-cased address in added order", () => {
    const withJana = Result.getOrThrow(
      addOfficeInvitee(initialOfficePeople, ` ${jana.toUpperCase()} `, {
        seatCapacity: 6,
      })
    );
    const withPetr = Result.getOrThrow(
      addOfficeInvitee(withJana, petr, { seatCapacity: 6 })
    );

    expect(withPetr).toEqual({ contactAttends: true, invitees: [jana, petr] });
  });

  test("rejects an address that isn't a full email address", () => {
    expect(
      addOfficeInvitee(initialOfficePeople, "petr.svoboda@", {
        seatCapacity: 6,
      })
    ).toEqual(Result.fail("invalid"));
  });

  test("rejects an address already on the list, whatever its case", () => {
    const people = { contactAttends: true, invitees: [jana] };

    expect(
      addOfficeInvitee(people, jana.toUpperCase(), { seatCapacity: 6 })
    ).toEqual(Result.fail("duplicate"));
  });

  test("rejects the contact's own address once it is known", () => {
    expect(
      addOfficeInvitee(initialOfficePeople, contactEmail, {
        seatCapacity: 6,
        contactEmail,
      })
    ).toEqual(Result.fail("contact"));
  });

  test("rejects anyone once every seat is taken", () => {
    const people = { contactAttends: true, invitees: [jana] };

    expect(addOfficeInvitee(people, petr, { seatCapacity: 2 })).toEqual(
      Result.fail("full")
    );
  });
});

describe("removing people", () => {
  test("removes an invitee by address and keeps the others in order", () => {
    const people = { contactAttends: true, invitees: [jana, petr] };

    expect(removeOfficeInvitee(people, jana)).toEqual({
      contactAttends: true,
      invitees: [petr],
    });
  });

  test("removes the contact and adds them back", () => {
    const people = { contactAttends: true, invitees: [jana] };
    const withoutContact = removeOfficeContact(people);

    expect(withoutContact).toEqual({ contactAttends: false, invitees: [jana] });
    expect(restoreOfficeContact(withoutContact)).toEqual(people);
  });

  test("keeps at least one person coming", () => {
    expect(canRemoveOfficePerson(initialOfficePeople)).toBe(false);
    expect(
      canRemoveOfficePerson({ contactAttends: false, invitees: [jana] })
    ).toBe(false);
    expect(
      canRemoveOfficePerson({ contactAttends: true, invitees: [jana] })
    ).toBe(true);
  });
});
