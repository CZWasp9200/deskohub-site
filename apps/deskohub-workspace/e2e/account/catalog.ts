import type { MagicLinkOperation } from "./rate-budget";
import type { WorkspaceE2EAccountLifecycleHandoff } from "./types";

export const workspaceE2EAccountCaseIds = [
  "account-anonymous-redirect",
  "account-sign-in-form",
  "account-sign-in-code",
  "account-magic-link-delivery",
  "account-profile-completion",
  "account-reservation-transitions",
  "account-deletion-marker-reauth",
  "account-session-lifecycle",
  "account-deletion-and-reactivation",
  "account-locale-preference",
  "account-linking-variants",
] as const;

export type WorkspaceE2EAccountCaseId =
  (typeof workspaceE2EAccountCaseIds)[number];

/**
 * The magic-link operations each account case spends, in the order it spends
 * them. Every case shares the runner's egress IP, so the whole serial lane
 * draws on one Better Auth rate window per magic-link path; a different
 * synthetic identity does not change that limiter key. The catalog test
 * replays this ledger through the real budget and fails if the lane would
 * wait out a quiet window, and the case factory test proves each executed
 * case spends exactly its entry. A new link must fit the remaining budget or
 * reuse a session or link the lane already spends.
 */
export const workspaceE2EAccountMagicLinkLedger = {
  "account-anonymous-redirect": [],
  // The main recipient's first link and a second unknown email, unconsumed
  // unless sign-in codes are on.
  "account-sign-in-form": ["send", "send"],
  // Enters the second unknown email's code. Code sign-in has its own Better
  // Auth path and limit (ten per ten minutes), and the case uses two.
  "account-sign-in-code": [],
  "account-magic-link-delivery": ["verify"],
  "account-profile-completion": [],
  "account-reservation-transitions": [],
  "account-deletion-marker-reauth": ["send"],
  // The reauthentication sign-in, which must land on the pending account's
  // saved Czech site from its English callback, and the rejected replay.
  "account-session-lifecycle": ["verify", "verify"],
  "account-deletion-and-reactivation": ["send", "verify"],
  // Reuses the session the reactivation sign-in opened; the saved-locale
  // sign-in landing is proved by the session-lifecycle reauthentication.
  "account-locale-preference": [],
  "account-linking-variants": [],
} as const satisfies Readonly<
  Record<WorkspaceE2EAccountCaseId, readonly MagicLinkOperation[]>
>;

/**
 * Why the lane skips a case on this preview, if it does. The sign-in code
 * case needs the code step the preview's `login_email_code` flag adds, and
 * the sign-in form case records which step the preview showed.
 */
export const workspaceE2EAccountCaseSkipReason = (
  caseId: WorkspaceE2EAccountCaseId,
  handoff: Pick<WorkspaceE2EAccountLifecycleHandoff, "signInConfirmation">
): string | undefined =>
  caseId === "account-sign-in-code" && handoff.signInConfirmation === "inbox"
    ? "Sign-in codes (login_email_code) are off on this preview"
    : undefined;
