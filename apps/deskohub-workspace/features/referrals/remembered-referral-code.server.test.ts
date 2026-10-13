import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { NextRequest } from "next/server";
import { referralCodeCookieName } from "./referral-code-cookie";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";

const browser = { cookie: "" };
mock.module("server-only", () => ({}));
const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({
  ...nextHeaders,
  cookies: async () =>
    new NextRequest("https://workspace.example/en-US", {
      headers: { cookie: browser.cookie },
    }).cookies,
}));

const { readRememberedReferralCode } = await import(
  "./remembered-referral-code.server"
);

/** Reads under a decision the caller already made for the request. */
const readUnder = (released: boolean) =>
  Effect.runPromise(
    readRememberedReferralCode.pipe(
      Effect.provide(ReferralFeatureFlagService.fromDecision(released))
    )
  );

describe("readRememberedReferralCode", () => {
  beforeEach(() => {
    browser.cookie = `${referralCodeCookieName}=rfl12345`;
  });

  test("reads the remembered shared code while the request has referrals enabled", async () => {
    expect(await readUnder(true)).toBe("RFL12345");
  });

  test("ignores the remembered code while the request has referrals off", async () => {
    expect(await readUnder(false)).toBeUndefined();
  });
});
