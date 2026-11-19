import type {
  CustomerAccountState,
  CustomerOrderState,
  CustomerReservationSummary,
} from "@deskohub/workspace-customer-api";
import { Match } from "effect";
import type { Href } from "expo-router";

/**
 * The Account tab's sections, in the approved order (reservations has its
 * own tab): the account's own sections, then Rewards, Privacy and the
 * Danger zone. `complete` takes the profile's place until the profile
 * exists.
 */
export const accountSectionOrder = [
  "complete",
  "profile",
  "security",
  "assistants",
  "billing",
  "payment-methods",
  "invoices",
  "language",
  "referrals",
  "legal",
  "danger",
] as const;
export type AccountSection = (typeof accountSectionOrder)[number];

/** The sections whose row opens a screen of its own. */
export type AccountScreenSection = Exclude<AccountSection, "payment-methods">;

export type AccountDetailSection = Exclude<AccountScreenSection, "complete">;

/**
 * Where each section's row on the Account tab leads. Payment methods has no
 * screen yet: its row only shows, behind its release.
 */
export const accountSectionHref = {
  referrals: "/account/referrals",
  // Onboarding opens above the tabs, over whichever tab asked for it.
  complete: "/onboarding",
  profile: "/account/profile",
  language: "/account/language",
  security: "/account/security",
  assistants: "/account/assistants",
  billing: "/account/billing",
  invoices: "/account/invoices",
  legal: "/account/legal",
  danger: "/account/danger",
} as const satisfies Record<AccountScreenSection, Href>;

/** The Account stack's detail screen, excluding Profile opened by checkout. */
export const accountDetailSection = (segments: readonly string[]) => {
  const [account, tabs, tab, detail] = segments;
  if (account !== "(account)" || tabs !== "(tabs)" || tab !== "account") {
    return undefined;
  }
  return accountSectionOrder.find(
    (section): section is AccountDetailSection =>
      section === detail &&
      section !== "complete" &&
      section !== "payment-methods"
  );
};

/** Why the account can't show its profile and reservations, if it can't. */
export type AccountNotice =
  | "completion-required"
  | "support-required"
  | "unavailable"
  | "deletion-pending";

const noticeOf = (account: CustomerAccountState): AccountNotice | undefined =>
  Match.value(account).pipe(
    Match.discriminatorsExhaustive("kind")({
      linked: () => undefined,
      "review-account": () => undefined,
      "completion-required": () => "completion-required" as const,
      "support-required": () => "support-required" as const,
      "authenticated-unavailable": () => "unavailable" as const,
      "deletion-pending": () => "deletion-pending" as const,
    })
  );

/**
 * Which of the Account tab's sections the app's releases show; the screen
 * reads each release, so the model never sees a feature flag.
 */
export interface AccountRelease {
  /** Saved payment methods (issue #412); off until that feature ships. */
  readonly paymentMethods: boolean;
}

const noRelease: AccountRelease = { paymentMethods: false };

const sectionAvailable: Record<
  AccountSection,
  (account: CustomerAccountState, release: AccountRelease) => boolean
> = {
  referrals: (account) => account.kind === "linked" && account.referralsEnabled,
  complete: (account) => account.kind === "completion-required",
  profile: (account) => account.kind === "linked",
  // The language is a sign-in setting, not profile data; the API refuses it
  // only while deletion is pending.
  language: (account) => account.kind !== "deletion-pending",
  billing: (account) => account.kind === "linked",
  "payment-methods": (account, release) =>
    account.kind === "linked" && release.paymentMethods,
  // The invoice list answers only for a linked account's own customer.
  invoices: (account) => account.kind === "linked",
  // Sign-in methods and assistants need only the session; the API leaves
  // them out while the release withholds passkeys or deletion is pending.
  security: (account) => account.passkeys !== undefined,
  assistants: (account) => account.assistants !== undefined,
  legal: () => true,
  danger: (account) =>
    account.kind !== "review-account" && account.deletion !== "withheld",
};

export interface AccountIndexModel {
  readonly sections: ReadonlyArray<AccountSection>;
  readonly notice: AccountNotice | undefined;
  /** Whether the danger zone shows a pending deletion to retry. */
  readonly deletionPending: boolean;
}

/**
 * What the Account tab's index shows for a GET /account result, with the
 * sections the app's releases show (none by default).
 */
export const accountIndexModel = (
  account: CustomerAccountState,
  release: AccountRelease = noRelease
): AccountIndexModel => ({
  sections: accountSectionOrder.filter((section) =>
    sectionAvailable[section](account, release)
  ),
  notice: noticeOf(account),
  deletionPending: account.deletion === "pending",
});

/** What the Reservations tab may show for the account. */
export type ReservationsAccess =
  | { readonly kind: "available" }
  /** The tab asks for the profile first and links to onboarding. */
  | { readonly kind: "completion-required" }
  | { readonly kind: "unavailable"; readonly notice: AccountNotice };

export const reservationsAccess = (
  account: CustomerAccountState
): ReservationsAccess =>
  Match.value(account).pipe(
    Match.discriminatorsExhaustive("kind")({
      linked: () => ({ kind: "available" }) as const,
      // A review account shows its sample reservations.
      "review-account": () => ({ kind: "available" }) as const,
      "completion-required": () => ({ kind: "completion-required" }) as const,
      "support-required": () =>
        ({ kind: "unavailable", notice: "support-required" }) as const,
      "authenticated-unavailable": () =>
        ({ kind: "unavailable", notice: "unavailable" }) as const,
      "deletion-pending": () =>
        ({ kind: "unavailable", notice: "deletion-pending" }) as const,
    })
  );

/**
 * The card a tab root shows in place of its content: Book and Reservations
 * ask for the profile first; Book says it is blocked while the account's
 * deletion runs, that support must check the account, or that the account
 * didn't load (with Try again), as board 25 draws them. Other states keep
 * the tab's own notice.
 */
export type TabGate = "profile" | "deletion" | "support" | "unavailable";

export const tabGate = (
  tab: "book" | "reservations",
  access: ReservationsAccess
): TabGate | undefined => {
  if (access.kind === "completion-required") return "profile";
  if (tab !== "book" || access.kind !== "unavailable") return undefined;
  return (
    {
      "deletion-pending": "deletion",
      "support-required": "support",
      unavailable: "unavailable",
      "completion-required": undefined,
    } as const satisfies Record<AccountNotice, TabGate | undefined>
  )[access.notice];
};

/** A history row opens its status screen only when it names an order. */
export const opensReservationStatus = (
  reservation: Pick<CustomerReservationSummary, "orderId">
) => reservation.orderId !== undefined;

/** A review-sandbox order never links to an access code. */
export const offersAccessCode = (
  order: Pick<CustomerOrderState, "reviewSandbox">
) => order.reviewSandbox !== true;
