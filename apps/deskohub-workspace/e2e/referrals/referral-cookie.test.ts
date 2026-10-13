import { expect, test } from "bun:test";
import { sharedReferralCodeRememberedDays } from "@/features/referrals/program";
import { describeCookie } from "../runtime";
import { isRememberedReferralCookie } from "./referral-cookie";

const nowSeconds = 1_800_000_000;
const rememberedCookie = {
  expires: nowSeconds + sharedReferralCodeRememberedDays * 86_400,
  httpOnly: false,
  path: "/",
  sameSite: "Lax",
  secure: true,
  value: "RFLSYNTHETIC1",
};

test("describes a cookie without exposing its value", () => {
  const description = describeCookie(
    rememberedCookie,
    "RFLSYNTHETIC1",
    nowSeconds
  );

  expect(description).toEqual({
    httpOnly: false,
    lifetimeDays: sharedReferralCodeRememberedDays,
    matches: true,
    path: "/",
    present: true,
    sameSite: "Lax",
    secure: true,
  });
  expect(JSON.stringify(description)).not.toContain("RFLSYNTHETIC1");
  expect(describeCookie(undefined, "RFLSYNTHETIC1")).toEqual({
    present: false,
  });
});

test("accepts only the remembered code with its first-party attributes", () => {
  const remembered = (
    overrides: Partial<typeof rememberedCookie>,
    expected = "RFLSYNTHETIC1"
  ) =>
    isRememberedReferralCookie(
      describeCookie(
        { ...rememberedCookie, ...overrides },
        expected,
        nowSeconds
      )
    );

  expect(remembered({})).toBe(true);
  expect(remembered({}, "RFLOTHERCODE")).toBe(false);
  expect(remembered({ httpOnly: true })).toBe(false);
  expect(remembered({ secure: false })).toBe(false);
  expect(remembered({ sameSite: "None" })).toBe(false);
  expect(remembered({ path: "/account" })).toBe(false);
  expect(remembered({ expires: -1 })).toBe(false);
  expect(remembered({ expires: nowSeconds + 86_400 })).toBe(false);
  expect(isRememberedReferralCookie({ present: false })).toBe(false);
});
