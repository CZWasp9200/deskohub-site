"use client";

import { useEffect } from "react";
import {
  browserCookieJar,
  findSharedReferralCodeToRemember,
  setReferralCodeCookie,
} from "./referral-code-cookie";

const isPrerendering = () =>
  (document as Document & { readonly prerendering?: boolean }).prerendering ===
  true;

/**
 * Remembers a shared referral code in the browser when the proxy could not.
 * A speculatively prerendered page never reaches the proxy as a navigation,
 * and the browser can activate it later without another document request. So
 * once the page is really shown, a code in its address is remembered like the
 * proxy would: only when none is remembered yet. A server render of that page
 * did not see the code; later navigations do.
 */
export function RememberSharedReferralCode() {
  useEffect(() => {
    const remember = () => {
      const code = findSharedReferralCodeToRemember(
        new URL(window.location.href).searchParams,
        browserCookieJar
      );
      if (code) {
        setReferralCodeCookie(
          browserCookieJar,
          code,
          window.location.protocol === "https:"
        );
      }
    };
    if (!isPrerendering()) {
      remember();
      return;
    }
    document.addEventListener("prerenderingchange", remember, { once: true });
    return () => document.removeEventListener("prerenderingchange", remember);
  }, []);
  return null;
}
