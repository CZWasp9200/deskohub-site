import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { referralCodeCookieName } from "./referral-code-cookie";

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

const referrals = { enabled: true };
mock.module("./referral-feature-flag.server", () => ({
  areReferralsEnabled: async () => referrals.enabled,
}));

const { readRememberedReferralCode } = await import(
  "./remembered-referral-code.server"
);

describe("readRememberedReferralCode", () => {
  beforeEach(() => {
    browser.cookie = `${referralCodeCookieName}=rfl12345`;
  });

  test("reads the remembered shared code while referrals are enabled", async () => {
    referrals.enabled = true;

    expect(await readRememberedReferralCode()).toBe("RFL12345");
  });

  test("ignores the remembered code while referrals are off", async () => {
    referrals.enabled = false;

    expect(await readRememberedReferralCode()).toBeUndefined();
  });
});
