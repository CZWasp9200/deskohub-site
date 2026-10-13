import "server-only";

import { cookies, headers } from "next/headers";
import type { ReferralCode } from "./client";
import {
  clearReferralCodeCookie,
  parseSharedReferralCode,
  referralCodeCookieName,
  setReferralCodeCookie,
} from "./referral-code-cookie";

/** The referral code this browser remembers from a shared link, if any. */
export const readRememberedReferralCode = async () =>
  parseSharedReferralCode((await cookies()).get(referralCodeCookieName)?.value);

const isSecureRequest = async () =>
  (await headers()).get("x-forwarded-proto") !== "http";

/**
 * Remembers a referral code the customer typed and checkout accepted,
 * replacing any shared-link code: a typed code wins, and an order edit then
 * keeps it. Server Actions and route handlers only.
 */
export const rememberReferralCode = async (code: ReferralCode) => {
  setReferralCodeCookie(await cookies(), code, await isSecureRequest());
};

/**
 * Forgets the remembered code from a Server Action or route handler. Server
 * Components cannot write cookies; they render `ForgetRememberedReferralCode`.
 */
export const forgetRememberedReferralCode = async () => {
  clearReferralCodeCookie(await cookies(), await isSecureRequest());
};
