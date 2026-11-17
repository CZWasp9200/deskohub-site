import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Effect } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { E2EBrowserSession } from "../browser-session";
import {
  makeReviewScreenshotEnvironment,
  reviewScreenshotsEnabled,
} from "../e2e-env";
import type { WorkspaceE2EError } from "../errors";
import { workspaceDir } from "../runtime";

/**
 * The review screenshot opt-in, decoded once through the E2E environment:
 * the payment retry case captures its pages only when it is on.
 */
const paymentRetryReviewEnabled = reviewScreenshotsEnabled(
  makeReviewScreenshotEnvironment()
);

/** The order's status page offering the retry, then the retry's Pay page. */
type PaymentRetryReviewTarget =
  | "checkout-status-payment-retry"
  | "checkout-pay-retry";

/** The phone width the boards hold at, then the desktop width. */
const reviewViewports = [
  { label: "360", height: 800, width: 360 },
  { label: "1440", height: 900, width: 1440 },
] as const;

const artifactPath = (target: PaymentRetryReviewTarget, viewport: string) =>
  resolve(
    workspaceDir,
    "e2e-artifacts",
    "account-review",
    `${target}-${viewport}.png`
  );

/** Whether the page is this order's status page or a Pay page. */
const isOwnedRetryPage = (
  actualUrl: string,
  orderId: WorkspaceReservationId
) => {
  const pathname = URL.parse(actualUrl)?.pathname ?? "";
  return (
    pathname.endsWith(`/reservation/status/${orderId}`) ||
    pathname.endsWith("/checkout/pay")
  );
};

/**
 * Captures the active page at each review width, when review screenshots are
 * on. It refuses a page that isn't the order's own, and masks inputs and
 * marked personal data.
 */
export const capturePaymentRetryReview = (input: {
  readonly orderId: WorkspaceReservationId;
  readonly session: E2EBrowserSession;
  readonly target: PaymentRetryReviewTarget;
}): Effect.Effect<void, WorkspaceE2EError> =>
  paymentRetryReviewEnabled
    ? input.session.use(`capture ${input.target} review`, async (page) => {
        const originalViewport = page.viewportSize();
        try {
          for (const viewport of reviewViewports) {
            if (!isOwnedRetryPage(page.url(), input.orderId)) {
              throw new Error("payment retry review left its order's pages");
            }
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
            const path = artifactPath(input.target, viewport.label);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, png);
          }
        } finally {
          if (originalViewport) await page.setViewportSize(originalViewport);
        }
      })
    : Effect.void;
