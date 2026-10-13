import { parseReferralCode, type ReferralCode } from "./client";
import { sharedReferralCodeRememberedDays } from "./program";

/**
 * First-party cookie remembering the referral code from the first shared
 * link this browser opened. It is strictly necessary: it only applies a
 * discount the visitor asked for. Readable by the browser so checkout and
 * profile completion can prefill it.
 */
export const referralCodeCookieName = "deskohub-referral-code";

const maxAgeSeconds = sharedReferralCodeRememberedDays * 24 * 60 * 60;

/** Syntactic check only; usability is decided where the code is used. */
export const parseSharedReferralCode = (
  value: string | null | undefined
): ReferralCode | undefined => parseReferralCode(value?.trim().toUpperCase());

type CookieWriter = {
  readonly set: (
    name: string,
    value: string,
    options: {
      readonly path: string;
      readonly sameSite: "lax";
      readonly secure: boolean;
      readonly maxAge: number;
      readonly httpOnly: false;
    }
  ) => unknown;
};

export const setReferralCodeCookie = (
  cookies: CookieWriter,
  code: ReferralCode,
  secure: boolean
) =>
  cookies.set(referralCodeCookieName, code, {
    path: "/",
    sameSite: "lax",
    secure,
    maxAge: maxAgeSeconds,
    httpOnly: false,
  });

/**
 * Expires the remembered code once it is used: the referral was recorded or
 * the customer's first paid booking made it moot.
 */
export const clearReferralCodeCookie = (
  cookies: CookieWriter,
  secure: boolean
) =>
  cookies.set(referralCodeCookieName, "", {
    path: "/",
    sameSite: "lax",
    secure,
    maxAge: 0,
    httpOnly: false,
  });
