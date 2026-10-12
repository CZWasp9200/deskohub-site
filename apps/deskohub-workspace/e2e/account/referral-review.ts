import type { Page } from "@playwright/test";
import type { Locale } from "@/features/i18n";
import { parseReferralCode } from "@/features/referrals/client";
import { workspaceE2EError } from "../errors";
import { workspaceE2ETimeouts } from "../timeouts";
import { accountSectionLandmarks } from "./account-sections";
import { referralStatsCondition } from "./referral-stats";
import {
  type AccountReviewDestination,
  captureAccountReview,
} from "./review-screenshots";

const referralCodeSelector = "#account-referrals-code";
const referralLinkSelector = "#account-referrals-link";
const referralEntrySelector = "form, input, textarea, select";
/** Waits for {@link referralStatsCondition} in a Playwright page. */
export const waitForReferralStats = async ({
  page,
  ...expected
}: Parameters<typeof referralStatsCondition>[0] & {
  readonly page: Page;
}) => {
  await page.waitForFunction(referralStatsCondition(expected), undefined, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
};

type ReferralOverviewTargets = {
  readonly desktop:
    | "linked-referrals-desktop"
    | "linked-referrals-cs-desktop"
    | "referral-overview-positive-desktop"
    | "referral-overview-positive-cs-desktop";
  readonly mobile:
    | "linked-referrals-mobile"
    | "linked-referrals-cs-mobile"
    | "referral-overview-positive-mobile"
    | "referral-overview-positive-cs-mobile";
};

export const verifyReferralOverview = async ({
  count,
  locale,
  page,
  review,
  targets,
}: {
  readonly count: number;
  readonly locale: Locale;
  readonly page: Page;
  readonly review: AccountReviewDestination;
  readonly targets: ReferralOverviewTargets;
}) => {
  await page.goto(
    new URL(`/${locale}/account?section=referrals`, review.baseUrl).toString(),
    { timeout: workspaceE2ETimeouts.browserNavigation }
  );
  await waitForReferralStats({ count, locale, page });

  await captureAccountReview(page, review, targets.desktop);
  await captureAccountReview(page, review, targets.mobile);
};

/**
 * Referrals are set once, so a share link opened by an already attributed
 * account changes nothing: the screen keeps only the customer's own code and
 * share link, with no form or field that could accept another code.
 */
export const verifyReferralScreenIgnoresShareLink = async ({
  baseUrl,
  page,
  shareCode,
}: {
  readonly baseUrl: string;
  readonly page: Page;
  readonly shareCode: string;
}) => {
  const locale = "en-US";
  const failure = (message: string) =>
    workspaceE2EError(message, {
      operation: "verify referral screen ignores share links",
    });
  const query = new URLSearchParams({ section: "referrals", ref: shareCode });
  await page.goto(
    new URL(`/${locale}/account?${query.toString()}`, baseUrl).toString(),
    { timeout: workspaceE2ETimeouts.browserNavigation }
  );
  const screen = page.locator(accountSectionLandmarks.referrals);
  const ownCode = screen.locator(referralCodeSelector);
  await ownCode.waitFor({
    state: "visible",
    timeout: workspaceE2ETimeouts.browserAction,
  });

  const code = (await ownCode.textContent())?.trim();
  if (parseReferralCode(code) === undefined || code === shareCode) {
    throw failure("referrals screen does not show the customer's own code");
  }
  const href = await screen
    .locator(referralLinkSelector)
    .getAttribute("href", { timeout: workspaceE2ETimeouts.browserAction });
  // Share links are absolute and carry no locale, so the recipient's
  // language decides which localized page opens.
  const link = href && URL.canParse(href) ? new URL(href) : undefined;
  if (
    link?.origin !== new URL(baseUrl).origin ||
    link.pathname !== "/account" ||
    link.searchParams.getAll("ref").join() !== code
  ) {
    throw failure("referrals screen does not share the customer's own code");
  }
  if ((await screen.locator(referralEntrySelector).count()) > 0) {
    throw failure("referrals screen still offers referral code entry");
  }
  if ((await screen.innerText()).includes(shareCode)) {
    throw failure("referrals screen shows the ignored share-link code");
  }

  // The case-level review capture follows on the plain referrals section.
  await page.goto(
    new URL(`/${locale}/account?section=referrals`, baseUrl).toString(),
    { timeout: workspaceE2ETimeouts.browserNavigation }
  );
  await ownCode.waitFor({
    state: "visible",
    timeout: workspaceE2ETimeouts.browserAction,
  });
};
