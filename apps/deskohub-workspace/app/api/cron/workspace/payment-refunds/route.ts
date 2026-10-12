import { Effect } from "effect";
import { NextResponse } from "next/server";
import { PaymentRefundService } from "@/features/checkout/backend/payment";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

export const maxDuration = 300;

/**
 * Runs hourly. At about 100 paid attempts a day, the 30-day window holds about
 * 3,000 recent payments; 150 checks an hour (3,600 a day) re-check each of
 * them within a day. At four concurrent lookups, even a batch of 5-second
 * Nexi timeouts finishes well inside `maxDuration`.
 */
const cronBatchLimit = 150;

/**
 * Nexi sends no notification for refunds made in its back office, so this
 * re-reads the Nexi orders of paid attempts awaiting a refund and of recent
 * payments not yet fully refunded, checked longest ago first, and records any
 * refund an operator already made there.
 */
const reconcileRefunds = Effect.fn("reconcileRefunds")(function* () {
  const refunds = yield* PaymentRefundService;
  const input = { limit: cronBatchLimit };
  yield* Effect.annotateLogsScoped({ input });
  yield* Effect.logInfo("Payment refund reconciliation started");

  const result = yield* refunds.reconcileRefunds(input);
  yield* Effect.annotateLogsScoped({ result });
  yield* Effect.logInfo("Payment refund reconciliation completed");

  return NextResponse.json(result);
}, Effect.scoped);

const handlePaymentRefundCronError = Effect.fn("handlePaymentRefundCronError")(
  function* (cause: unknown) {
    yield* Effect.logError("Payment refund reconciliation cron failed", {
      cause,
    });

    return NextResponse.json(
      { error: "Payment refund reconciliation failed" },
      { status: 500 }
    );
  }
);

export const GET = defineWorkspaceRoute(
  {
    operation: "paymentRefundReconciliationCron",
    cancellation: "continue-after-disconnect",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized payment refund reconciliation cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return reconcileRefunds().pipe(
      Effect.provide(PaymentRefundService.Live),
      Effect.catch(handlePaymentRefundCronError)
    );
  }
);
