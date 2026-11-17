import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema";
import { m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EConfig } from "../config";
import {
  makeReviewScreenshotEnvironment,
  reviewScreenshotsEnabled,
} from "../e2e-env";
import { tryWorkspaceE2ESync } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { workspaceDir } from "../runtime";
import { applyDiscountCode } from "./discount-code";

/**
 * The review screenshot opt-in, decoded once through the E2E environment:
 * the discount-code case adds its removal review step only when it is on.
 */
export const discountCodeRemovalReviewEnabled = reviewScreenshotsEnabled(
  makeReviewScreenshotEnvironment()
);

const discountCodeRemovalReviewTargets = [
  "checkout-discount-code-applied",
  "checkout-discount-code-removal-refused",
  "checkout-discount-code-removed-review",
] as const;

type DiscountCodeRemovalReviewTarget =
  (typeof discountCodeRemovalReviewTargets)[number];

/** The phone width the boards hold at, then the desktop width. */
const reviewViewports = [
  { label: "360", height: 800, width: 360 },
  { label: "1440", height: 900, width: 1440 },
] as const;

type ReviewViewportLabel = (typeof reviewViewports)[number]["label"];

export const getDiscountCodeRemovalReviewArtifactPath = (
  target: DiscountCodeRemovalReviewTarget,
  viewport: ReviewViewportLabel
) =>
  resolve(
    workspaceDir,
    "e2e-artifacts",
    "account-review",
    `${target}-${viewport}.png`
  );

type PayPageOwnership = {
  readonly baseUrl: string;
  readonly orderId: WorkspaceReservationId;
  /**
   * The Pay state already seen on this order's Pay page. A refused code change
   * redirects with the same Pay state and no order id.
   */
  readonly payState?: string;
};

/** Whether `actualUrl` is this order's Pay page on the target deployment. */
export const isOwnedPayPageUrl = ({
  actualUrl,
  baseUrl,
  orderId,
  payState,
}: PayPageOwnership & { readonly actualUrl: string }) => {
  const actual = URL.parse(actualUrl);
  const base = URL.parse(baseUrl);
  if (
    actual === null ||
    base === null ||
    actual.origin !== base.origin ||
    actual.pathname !== "/en-US/checkout/pay"
  )
    return false;
  const orderIds = actual.searchParams.getAll("orderId");
  if (orderIds.length > 0)
    return orderIds.length === 1 && orderIds[0] === orderId;
  const payStates = actual.searchParams.getAll("payState");
  return (
    payState !== undefined &&
    payStates.length === 1 &&
    payStates[0] === payState
  );
};

const removeControl = (page: Page) =>
  page.locator("[data-checkout-discount-code-remove] button[type='submit']");

const capture = async (
  page: Page,
  target: DiscountCodeRemovalReviewTarget,
  ownership: PayPageOwnership
) => {
  const originalViewport = page.viewportSize();
  try {
    for (const viewport of reviewViewports) {
      assertOwned(page.url(), ownership);
      const artifactPath = getDiscountCodeRemovalReviewArtifactPath(
        target,
        viewport.label
      );
      await mkdir(dirname(artifactPath), { recursive: true });
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const png = await page.screenshot({
        animations: "disabled",
        fullPage: true,
        mask: [page.locator("input, [data-ph-mask]")],
        type: "png",
      });
      assertOwned(page.url(), ownership);
      await writeFile(artifactPath, png);
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
};

const assertOwned = (actualUrl: string, ownership: PayPageOwnership) => {
  if (!isOwnedPayPageUrl({ actualUrl, ...ownership })) {
    throw new Error("discount-code review is outside its order's Pay page");
  }
};

/** Submits the Remove control and waits for the Pay page it redirects to. */
const submitRemoval = async (page: Page, timeout: number) => {
  const before = page.url();
  await removeControl(page).click({ timeout });
  await page.waitForURL((url) => url.href !== before, {
    timeout,
    waitUntil: "load",
  });
};

/**
 * Ends the order's hold for `effect` and restores its deadline afterwards, so
 * a removal can be refused for an ended hold while the order stays payable.
 * The hold cleanup queue judges the stored deadline when it runs, so the
 * restored deadline keeps the hold.
 */
const withHoldEnded = <A, E, R>(
  orderId: WorkspaceReservationId,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const { db } = yield* E2EDatabase;
      const [held] = yield* runDatabaseOperation(
        "read review order hold deadline",
        db
          .select({
            expiresAt: workspaceReservations.reservationHoldExpiresAt,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, orderId))
      );
      const expiresAt = yield* tryWorkspaceE2ESync(
        "read review order hold deadline",
        () => {
          if (!held?.expiresAt) throw new Error("review order is not held");
          return held.expiresAt;
        }
      );
      yield* runDatabaseOperation(
        "end review order hold",
        db
          .update(workspaceReservations)
          .set({
            reservationHoldExpiresAt: Temporal.Now.instant().subtract({
              seconds: 1,
            }),
          })
          .where(
            and(
              eq(workspaceReservations.id, orderId),
              eq(workspaceReservations.reservationState, "held")
            )
          )
      );
      return expiresAt;
    }),
    () => effect,
    (expiresAt) => restoreHoldDeadline(orderId, expiresAt).pipe(Effect.orDie)
  );

const restoreHoldDeadline = Effect.fn("e2e.restoreReviewHoldDeadline")(
  function* (orderId: WorkspaceReservationId, expiresAt: Temporal.Instant) {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "restore review order hold deadline",
      db
        .update(workspaceReservations)
        .set({ reservationHoldExpiresAt: expiresAt })
        .where(eq(workspaceReservations.id, orderId))
    );
  }
);

/**
 * PR review screenshots of the Pay page's Remove control, for runs with
 * WORKSPACE_E2E_REVIEW_SCREENSHOTS=true: the applied code with Remove, the
 * removal refused once the hold has ended, and the price review the removal
 * opens. The code is applied again afterwards, so the case pays as before.
 */
export const reviewDiscountCodeRemoval = Effect.fn(
  "e2e.reviewDiscountCodeRemoval"
)(function* ({
  appliedMessage,
  code,
  config,
  orderId,
  session,
}: {
  readonly appliedMessage: string;
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly orderId: WorkspaceReservationId;
  readonly session: E2EBrowserSession;
}) {
  const ownership = { baseUrl: config.baseUrl, orderId };
  const timeout = config.timeouts.uiTransition;

  const appliedUrl = yield* session.use(
    "capture applied discount code review",
    async (page) => {
      await removeControl(page).waitFor({ state: "visible", timeout });
      await capture(page, "checkout-discount-code-applied", ownership);
      return page.url();
    }
  );

  const appliedPayState =
    new URL(appliedUrl).searchParams.get("payState") ?? undefined;
  yield* withHoldEnded(
    orderId,
    session.use("capture refused discount code removal", async (page) => {
      await submitRemoval(page, timeout);
      await capture(page, "checkout-discount-code-removal-refused", {
        ...ownership,
        payState: appliedPayState,
      });
    })
  );

  yield* session.use("capture discount code removal review", async (page) => {
    await page.goto(appliedUrl, { timeout, waitUntil: "load" });
    await submitRemoval(page, timeout);
    await removeControl(page).waitFor({ state: "detached", timeout });
    await capture(page, "checkout-discount-code-removed-review", ownership);
    await page
      .getByRole("link", {
        name: m.checkoutPayReviewUpdatedPriceButton({}, { locale: "en-US" }),
      })
      .click({ timeout });
    await page
      .locator("#checkout-discount-code-form")
      .waitFor({ state: "visible", timeout });
  });

  yield* applyDiscountCode({ appliedMessage, code, config, session });
});
