import { describe, expect, test } from "bun:test";
import { DateTime, Option, Schema } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  NextSignInEmailAt,
  NextSignInEmailAtFromClient,
  resendCooldownSecondsAtom,
  SIGN_IN_EMAIL_RESEND_COOLDOWN_MS,
} from "./sign-in-email";

describe("NextSignInEmailAt", () => {
  test("decodes the server's ISO instant and encodes it back unchanged", () => {
    const wire = "2026-11-15T20:41:07.123Z";

    const decoded = Schema.decodeUnknownSync(NextSignInEmailAt)(wire);

    expect(DateTime.toEpochMillis(decoded)).toBe(Date.parse(wire));
    expect(Schema.encodeSync(NextSignInEmailAt)(decoded)).toBe(wire);
  });

  test("refuses a value that is not an instant", () => {
    expect(
      Option.isNone(Schema.decodeUnknownOption(NextSignInEmailAt)("soon"))
    ).toBe(true);
    expect(
      Option.isNone(Schema.decodeUnknownOption(NextSignInEmailAt)(60))
    ).toBe(true);
  });
});

describe("NextSignInEmailAtFromClient", () => {
  const decode = Schema.decodeUnknownOption(NextSignInEmailAtFromClient);
  const at = "2026-11-15T20:41:07.123Z";

  test("decodes the wire string and the Date a Better Auth client revives it into", () => {
    for (const answer of [at, new Date(at)]) {
      expect(Option.map(decode(answer), DateTime.toEpochMillis)).toEqual(
        Option.some(Date.parse(at))
      );
    }
  });

  test("refuses anything that is not a valid instant", () => {
    for (const answer of [
      new Date("not a date"),
      "2026-13-45T99:00:00Z",
      "soon",
      60,
      null,
      undefined,
    ]) {
      expect(Option.isNone(decode(answer))).toBe(true);
    }
  });
});

describe("resendCooldownSecondsAtom", () => {
  test("starts at the whole seconds left and reads 0 once the wait is over", () => {
    const registry = AtomRegistry.make();
    const availableAt = Date.now() + SIGN_IN_EMAIL_RESEND_COOLDOWN_MS;

    expect(registry.get(resendCooldownSecondsAtom(availableAt))).toBe(
      SIGN_IN_EMAIL_RESEND_COOLDOWN_MS / 1000
    );
    expect(registry.get(resendCooldownSecondsAtom(Date.now() - 1000))).toBe(0);
    registry.dispose();
  });
});
