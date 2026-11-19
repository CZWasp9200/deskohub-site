import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { personInitials } from "./person-row";

describe("personInitials", () => {
  test("takes the first and last name's first letters", () => {
    expect(
      personInitials({
        name: " alex  middle sample ",
        email: testEmailAddress("alex.sample"),
      })
    ).toBe("AS");
    expect(
      personInitials({ name: "Alex", email: testEmailAddress("alex") })
    ).toBe("A");
  });

  test("falls back to the email address's first letter without a name", () => {
    expect(personInitials({ email: testEmailAddress("jana.novak") })).toBe("J");
    expect(personInitials({ name: " ", email: testEmailAddress("petr") })).toBe(
      "P"
    );
  });
});
