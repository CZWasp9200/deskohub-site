import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Option } from "effect";
import {
  addOfficePerson,
  addYou,
  canAddOfficePerson,
  canRemoveOfficePerson,
  type OfficePeople,
  officePeopleCount,
  removeInvitee,
  removeYou,
  youOnly,
} from "./office-people";

const contactEmail = Option.some(testEmailAddress("alex.sample"));
/** Not the live office's capacity: a hard-coded maximum would fail. */
const maximumSeats = Option.some(3);
const context = { contactEmail, maximumSeats };

const withInvitees = (...invitees: string[]): OfficePeople => ({
  contactAttends: true,
  invitees,
});

describe("office people", () => {
  test("count one seat per person, You included while attending", () => {
    expect(officePeopleCount(youOnly)).toBe(1);
    expect(officePeopleCount(withInvitees(testEmailAddress("a")))).toBe(2);
    expect(
      officePeopleCount({
        contactAttends: false,
        invitees: [testEmailAddress("a")],
      })
    ).toBe(1);
  });

  test("adds a trimmed, lower-cased address after the others", () => {
    const added = addOfficePerson(
      withInvitees(testEmailAddress("a")),
      `  ${testEmailAddress("Jana.Novak").toUpperCase()} `,
      context
    );
    expect(added).toEqual({
      _tag: "Added",
      people: withInvitees(
        testEmailAddress("a"),
        testEmailAddress("jana.novak")
      ),
    });
  });

  test("rejects an address that isn't whole", () => {
    for (const typed of [
      "",
      "petr.svoboda@",
      `petr ${testEmailAddress("svoboda")}`,
    ]) {
      expect(addOfficePerson(youOnly, typed, context)._tag).toBe("Invalid");
    }
  });

  test("keeps the list when the address is already on it, in any case", () => {
    const people = withInvitees(testEmailAddress("jana.novak"));
    expect(
      addOfficePerson(people, testEmailAddress("JANA.NOVAK"), context)._tag
    ).toBe("Listed");
    expect(
      addOfficePerson(people, testEmailAddress("Alex.Sample"), context)._tag
    ).toBe("Listed");
  });

  test("puts You back for the customer's own address", () => {
    const people = { contactAttends: false, invitees: [testEmailAddress("a")] };
    expect(
      addOfficePerson(people, testEmailAddress("alex.sample"), context)
    ).toEqual({
      _tag: "Added",
      people: { contactAttends: true, invitees: [testEmailAddress("a")] },
    });
  });

  test("adds no one once every seat is taken, and anyone while capacity is unknown", () => {
    const full = withInvitees(testEmailAddress("a"), testEmailAddress("b"));
    expect(canAddOfficePerson(full, maximumSeats)).toBe(false);
    expect(addOfficePerson(full, testEmailAddress("c"), context)._tag).toBe(
      "Full"
    );
    expect(canAddOfficePerson(full, Option.none())).toBe(true);
  });

  test("always keeps someone on the list", () => {
    expect(canRemoveOfficePerson(youOnly)).toBe(false);
    expect(removeYou(youOnly)).toBe(youOnly);
    const alone = { contactAttends: false, invitees: [testEmailAddress("a")] };
    expect(removeInvitee(alone, testEmailAddress("a"))).toBe(alone);
  });

  test("removes You or an invited person while someone stays", () => {
    const people = withInvitees(testEmailAddress("a"), testEmailAddress("b"));
    expect(removeYou(people)).toEqual({
      contactAttends: false,
      invitees: [testEmailAddress("a"), testEmailAddress("b")],
    });
    expect(removeInvitee(people, testEmailAddress("a"))).toEqual(
      withInvitees(testEmailAddress("b"))
    );
  });

  test("adds You back only into a free seat", () => {
    const without = {
      contactAttends: false,
      invitees: [testEmailAddress("a")],
    };
    expect(addYou(without, maximumSeats)).toEqual(
      withInvitees(testEmailAddress("a"))
    );
    const full = {
      contactAttends: false,
      invitees: [
        testEmailAddress("a"),
        testEmailAddress("b"),
        testEmailAddress("c"),
      ],
    };
    expect(addYou(full, maximumSeats)).toBe(full);
  });
});
