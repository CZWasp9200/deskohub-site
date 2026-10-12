import { Effect } from "effect";
import { NextResponse } from "next/server";
import { PaymentRefundService } from "@/features/checkout/backend/payment";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const cronBatchLimit = 50;

/**
 * Fallback for refund notifications Nexi does not deliver: re-reads the Nexi
 * orders of paid attempts awaiting a refund, then of recent payments nobody
 * marked for refund, checked longest ago first, and records any refund an
 * operator already made in the Nexi back office.
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
