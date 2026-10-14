import { expect, test } from "bun:test";
import { sharedReferralCodeRememberedDays } from "@/features/referrals/program";
import { describeCookie } from "../runtime";

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
