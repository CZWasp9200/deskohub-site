import { describe, expect, it } from "bun:test";
import { registrationAvailability } from "./registration-availability";

const now = new Date("2026-12-01T12:00:00Z");
const upcoming = {
  startsAt: new Date("2026-12-05T17:00:00Z"),
  endsAt: null,
  capacity: 8,
  registrationOpen: true,
  registrationCount: 3,
  isRegistered: false,
};

describe("registrationAvailability", () => {
  it("lets a signed-in customer register while places are free", () => {
    expect(registrationAvailability(upcoming, { signedIn: true, now })).toBe(
      "open"
    );
  });

  it("asks a signed-out visitor to sign in", () => {
    expect(registrationAvailability(upcoming, { signedIn: false, now })).toBe(
      "signedOut"
    );
  });

  it("reports a full event, but not to someone already registered", () => {
    const full = { ...upcoming, registrationCount: 8 };
    expect(registrationAvailability(full, { signedIn: true, now })).toBe(
      "full"
    );
    expect(
      registrationAvailability(
        { ...full, isRegistered: true },
        { signedIn: true, now }
      )
    ).toBe("registered");
  });

  it("treats an event without capacity as never full", () => {
    expect(
      registrationAvailability(
        { ...upcoming, capacity: null, registrationCount: 500 },
        { signedIn: true, now }
      )
    ).toBe("open");
  });

  it("reports closed registration", () => {
    expect(
      registrationAvailability(
        { ...upcoming, registrationOpen: false },
        { signedIn: true, now }
      )
    ).toBe("closed");
  });

  it("uses the end time to decide an event is over", () => {
    const running = {
      ...upcoming,
      startsAt: new Date("2026-12-01T10:00:00Z"),
      endsAt: new Date("2026-12-01T14:00:00Z"),
    };
    expect(registrationAvailability(running, { signedIn: true, now })).toBe(
      "open"
    );
    expect(
      registrationAvailability(
        { ...running, endsAt: null, isRegistered: true },
        { signedIn: true, now }
      )
    ).toBe("past");
  });
});
