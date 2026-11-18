import { describe, expect, test } from "bun:test";
import { signedInDestination } from "./signed-in-destination";

describe("the signed-in rail", () => {
  test("reserves the product highlight for a Choose route or its checkout", () => {
    expect(
      signedInDestination(["(account)", "(tabs)", "book"])
    ).toBeUndefined();
    expect(signedInDestination(["(account)", "book", "meeting-room"])).toBe(
      "meeting-room"
    );
    expect(
      signedInDestination(["(account)", "book", "checkout"], "office")
    ).toBe("office");
    expect(
      signedInDestination(["(account)", "book", "profile"], "cowork")
    ).toBe("cowork");
  });

  test("highlights Reservations on its tab and on a cold-linked access route", () => {
    expect(signedInDestination(["(account)", "(tabs)", "reservations"])).toBe(
      "reservations"
    );
    expect(
      signedInDestination(["(account)", "reservations", "[orderId]", "access"])
    ).toBe("reservations");
  });

  test("keeps account section routes and onboarding distinct", () => {
    expect(
      signedInDestination(["(account)", "(tabs)", "account", "profile"])
    ).toBe("account");
    expect(
      signedInDestination(["(account)", "onboarding", "billing"], "office")
    ).toBeUndefined();
  });
});
