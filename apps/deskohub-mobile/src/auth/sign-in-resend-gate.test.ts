import { describe, expect, test } from "bun:test";
import { SIGN_IN_EMAIL_RESEND_COOLDOWN_MS } from "@deskohub/workspace-customer-api/sign-in-email";
import { DateTime, Option } from "effect";
import { signInResendAvailableAt } from "./sign-in-resend-gate";

const sentAt = Date.UTC(2026, 10, 15, 20, 0, 0);
const cooldownEnds = sentAt + SIGN_IN_EMAIL_RESEND_COOLDOWN_MS;
const serverAt = (epochMs: number) => Option.some(DateTime.makeUnsafe(epochMs));

describe("signInResendAvailableAt", () => {
  test("waits out the cooldown when the server names no instant", () => {
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: Option.none(),
        cooldownWaived: false,
      })
    ).toBe(cooldownEnds);
  });

  test("waits for the server when it accepts the next email later", () => {
    const later = cooldownEnds + 5 * 60_000;
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(later),
        cooldownWaived: false,
      })
    ).toBe(later);
  });

  test("keeps the cooldown when the server accepts the next email sooner", () => {
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(sentAt),
        cooldownWaived: false,
      })
    ).toBe(cooldownEnds);
  });

  test("takes either instant when they coincide", () => {
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(cooldownEnds),
        cooldownWaived: false,
      })
    ).toBe(cooldownEnds);
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(cooldownEnds + 1),
        cooldownWaived: false,
      })
    ).toBe(cooldownEnds + 1);
  });

  test("a waived cooldown leaves only the server's instant", () => {
    const later = sentAt + 10_000;
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(later),
        cooldownWaived: true,
      })
    ).toBe(later);
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(cooldownEnds + 60_000),
        cooldownWaived: true,
      })
    ).toBe(cooldownEnds + 60_000);
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: serverAt(sentAt - 1),
        cooldownWaived: true,
      })
    ).toBe(sentAt - 1);
  });

  test("a waived cooldown without a server instant offers the email at once", () => {
    expect(
      signInResendAvailableAt({
        sentAt,
        nextSignInEmailAt: Option.none(),
        cooldownWaived: true,
      })
    ).toBe(sentAt);
  });
});
