import { Duration, Effect } from "effect";
import { NextResponse } from "next/server";
import { PaymentRefundService } from "@/features/checkout/backend/payment";
import { nexiRequestWorstCaseDuration } from "@/shared/backend/config/nexi.config";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

export const maxDuration = 300;

/**
 * Time the batch may spend claiming, looking up, and recording. It starts a
 * lookup only while one exhausting every Nexi retry still ends within it, and
 * at the budget it interrupts whatever is still running and releases those
 * claims, each release waiting at most `claimReleaseTimeout` (10 seconds).
 * The batch therefore ends within 250 seconds, leaving the rest of
 * `maxDuration` for the cold start and the response.
 */
const lookupBudget = Duration.seconds(240);

/**
 * Runs hourly. At about 100 paid attempts a day, the 30-day window holds about
 * 3,000 recent payments; 150 checks an hour (3,600 a day) re-check each of
 * them within a day while Nexi answers normally (four lookups of about a
 * second each run at a time). While every lookup times out, a production
 * lookup takes up to about 21 seconds with retries, so a run checks about 44
 * attempts and leaves the rest unclaimed for the next run.
 */
const cronBatchLimit = 150;

/**
 * Production has received no Nexi notification for refunds made in the Nexi
 * back office, so polling is the primary way to record them. The webhook still
 * records a refund if Nexi does notify. This re-reads the Nexi orders of paid
 * attempts awaiting a refund and of recent payments not yet fully refunded,
 * checked longest ago first, and records any refund an operator made there.
 */
const reconcileRefunds = Effect.fn("reconcileRefunds")(function* () {
  const refunds = yield* PaymentRefundService;
  const input = {
    limit: cronBatchLimit,
    budget: lookupBudget,
    worstCaseLookupDuration: nexiRequestWorstCaseDuration,
  };
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
