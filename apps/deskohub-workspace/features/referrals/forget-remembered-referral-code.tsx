"use client";

import { useEffect } from "react";
import { referralCodeCookieName } from "./referral-code-cookie";

/**
 * Forgets the remembered referral code from a page whose server render found
 * it used, because Server Components cannot write cookies.
 */
export function ForgetRememberedReferralCode() {
  useEffect(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: The remembered code is a first-party, non-HttpOnly cookie that only this page can expire.
    document.cookie = `${referralCodeCookieName}=; Max-Age=0; Path=/; SameSite=Lax${
      window.location.protocol === "https:" ? "; Secure" : ""
    }`;
  }, []);
  return null;
}
