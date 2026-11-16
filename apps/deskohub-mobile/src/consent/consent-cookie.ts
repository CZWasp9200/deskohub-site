import { consentBannerRevision } from "@deskohub/workspace-customer-api/consent-banner";
import {
  type ConsentCategory,
  consentCategories,
  isConsentCategory,
  type StoredConsent,
} from "./analytics-consent";

/**
 * The site's consent cookie. The web app shares its origin, so this cookie is
 * the one consent answer for both; the site's banner (vanilla-cookieconsent
 * 3.1.0) reads what the app writes.
 */
export const consentCookieName = "cc_cookie";

/** vanilla-cookieconsent's default lifetime, which the site keeps. */
const consentLifetimeDays = 182;

const cookieValues = (cookieString: string): string[] =>
  new URLSearchParams(cookieString.replace(/;\s*/g, "&")).getAll(
    consentCookieName
  );

const parseCookieJson = (cookieValue: string): unknown => {
  try {
    return JSON.parse(cookieValue);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(cookieValue));
    } catch {
      return undefined;
    }
  }
};

/**
 * A copy's accepted categories, `null` when the copy is malformed, or
 * `"other-revision"` when it was saved under another banner revision, which
 * the site reads as no choice.
 */
const copyCategories = (
  cookieValue: string
): ConsentCategory[] | null | "other-revision" => {
  // An emptied copy accepts nothing without being malformed.
  if (cookieValue === "") return [];
  const value = parseCookieJson(cookieValue);
  if (typeof value !== "object" || value === null) return null;
  const { categories, revision } = value as {
    readonly categories?: unknown;
    readonly revision?: unknown;
  };
  if (!Array.isArray(categories)) return null;
  if (!categories.every(isConsentCategory)) return null;
  return revision === consentBannerRevision ? categories : "other-revision";
};

/**
 * Reads the consent answer from `document.cookie` the way the site's
 * `getAcceptedConsentCategoriesFromCookie` does: the categories every copy
 * accepts, and none when any copy is malformed. No cookie, or a copy saved
 * under another banner revision, is no answer, so the choice is asked again.
 */
export const readConsentCookie = (cookieString: string): StoredConsent => {
  const values = cookieValues(cookieString);
  if (values.length === 0) return { kind: "undecided" };
  const copies = values.map(copyCategories);
  if (copies.some((copy) => copy === null)) {
    return { kind: "decided", categories: [] };
  }
  const saved = copies.filter((copy) => Array.isArray(copy));
  if (saved.length < copies.length) return { kind: "undecided" };
  return {
    kind: "decided",
    categories: consentCategories.filter((category) =>
      saved.every((copy) => copy.includes(category))
    ),
  };
};

/** The cookie's earlier record, kept so the site sees the same consent. */
const earlierRecord = (
  cookieString: string
): Readonly<Record<string, unknown>> | undefined => {
  const [value, ...others] = cookieValues(cookieString);
  if (value === undefined || others.length > 0) return undefined;
  const parsed = parseCookieJson(value);
  // A record of another banner revision is a choice the site no longer
  // holds, so the save starts afresh, as the site's banner does.
  return typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    (parsed as { readonly revision?: unknown }).revision ===
      consentBannerRevision
    ? (parsed as Readonly<Record<string, unknown>>)
    : undefined;
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/**
 * The `document.cookie` assignment that saves a consent answer in
 * vanilla-cookieconsent's format, under the site's banner revision. It keeps
 * the earlier record's consent ID, first-consent time and other fields when it
 * was saved under that revision, dates the save at
 * `decidedAt` (an account decision keeps the account's instant, as the
 * site's own copy does), and writes the cookie with the library's attributes
 * so it replaces the site's copy.
 */
export const consentCookieAssignment = ({
  cookieString,
  categories,
  now,
  decidedAt,
  hostname,
  secure,
  languageCode,
  createConsentId,
}: {
  readonly cookieString: string;
  readonly categories: readonly ConsentCategory[];
  readonly now: Date;
  /** When the choice was made, as an ISO 8601 instant. */
  readonly decidedAt: string;
  readonly hostname: string;
  readonly secure: boolean;
  readonly languageCode: string;
  readonly createConsentId: () => string;
}): string => {
  const earlier = earlierRecord(cookieString);
  const expires = new Date(
    now.getTime() + consentLifetimeDays * 24 * 60 * 60 * 1000
  );
  const record = {
    data: null,
    services: {},
    languageCode,
    ...earlier,
    // The site, its server and this bundle accept only this revision.
    revision: consentBannerRevision,
    categories,
    consentId: nonEmptyString(earlier?.consentId)
      ? earlier.consentId
      : createConsentId(),
    consentTimestamp: nonEmptyString(earlier?.consentTimestamp)
      ? earlier.consentTimestamp
      : now.toISOString(),
    lastConsentTimestamp: decidedAt,
    expirationTime: expires.getTime(),
  };
  const attributes = [
    `expires=${expires.toUTCString()}`,
    "Path=/",
    "SameSite=Lax",
    ...(hostname.includes(".") ? [`Domain=${hostname}`] : []),
    ...(secure ? ["Secure"] : []),
  ];
  return [
    `${consentCookieName}=${encodeURIComponent(JSON.stringify(record))}`,
    ...attributes,
  ].join("; ");
};
