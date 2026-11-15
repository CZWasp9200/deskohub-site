import { describe, expect, test } from "bun:test";
import { DateTime, Option, Schema } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  NextSignInEmailAt,
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
