import { Effect } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  activateHydratedElement,
  waitForPageCondition,
  waitForPageUrl,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EError } from "../errors";
import { parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";

/** The status page control that pays the same order again. */
export const retryPaymentSelector = "#checkout-status-try-payment-again";

/** Whether a URL is the same order's Pay page a payment retry opens. */
const isRetryPayUrl = (value: string, orderId: WorkspaceReservationId) => {
  const url = parseUrl(value);
  const urlOrderId = url?.searchParams.get("orderId");
  return (
    url?.pathname.endsWith("/checkout/pay") === true &&
    (urlOrderId === null || urlOrderId === orderId)
  );
};

/**
 * Pays the same order again from its status page: "Try payment again" opens
 * that order's Pay page, which asks for the terms again.
 */
export const retryPaymentInPlace = ({
  label,
  orderId,
  session,
  timeouts,
}: {
  /** What is retried, for step descriptions. */
  readonly label: string;
  readonly orderId: WorkspaceReservationId;
  readonly session: E2EBrowserSession;
  readonly timeouts: Pick<WorkspaceE2ETimeouts, "uiTransition">;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* activateHydratedElement(session, retryPaymentSelector, {
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForPageUrl({
      description: `${label} retried on the same order's Pay page`,
      matches: (url) => isRetryPayUrl(url, orderId),
      session,
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForPageCondition(
      session,
      `${label} retry asks for the terms again`,
      (selector) => document.querySelector(selector) !== null,
      "#checkout-pay-legal-consent",
      { timeoutMs: timeouts.uiTransition }
    );
  });
