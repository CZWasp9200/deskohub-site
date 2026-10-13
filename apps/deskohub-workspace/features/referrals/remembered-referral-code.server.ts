import "server-only";

import { cookies, headers } from "next/headers";
import {
  clearReferralCodeCookie,
  parseSharedReferralCode,
  referralCodeCookieName,
} from "./referral-code-cookie";

/** The referral code this browser remembers from a shared link, if any. */
export const readRememberedReferralCode = async () =>
  parseSharedReferralCode((await cookies()).get(referralCodeCookieName)?.value);

/**
 * Forgets the remembered code from a Server Action or route handler. Server
 * Components cannot write cookies; they render `ForgetRememberedReferralCode`.
 */
export const forgetRememberedReferralCode = async () => {
  const forwardedProtocol = (await headers()).get("x-forwarded-proto");
  clearReferralCodeCookie(await cookies(), forwardedProtocol !== "http");
};
