import { NexiService, summarizeNexiRefunds } from "@deskohub/nexi";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  type PaymentRefundRecordResult,
  PaymentRefundRepository,
  type RefundablePaymentAttempt,
} from "../repositories/payment-refund.repository";

/**
 * `no_refund` means Nexi reports no successful refund for the attempt's order
 * yet; the other results come from recording the refund.
 */
type PaymentRefundReconciliationResult =
  | PaymentRefundRecordResult
  | "no_refund";

interface PaymentRefundReconciliationSummary {
  readonly checked: number;
  readonly recorded: number;
  readonly failed: number;
}

export class PaymentRefundReconciliationError extends Data.TaggedError(
  "PaymentRefundReconciliationError"
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface IPaymentRefundService {
  /**
   * Reads the attempt's Nexi order and records any successful refund on the
   * attempt. Operators refund in the Nexi back office, so Nexi's order
   * operations are the only evidence that money went back.
   */
  readonly reconcileAttempt: (
    input: RefundablePaymentAttempt
  ) => Effect.Effect<
    PaymentRefundReconciliationResult,
    PaymentRefundReconciliationError
  >;
  /**
   * Reconciles a batch of attempts still awaiting a refund and recent payments
   * Nexi has not fully refunded, least recently checked first, skipping any
   * checked in the last few hours. One attempt's provider failure is logged
   * and does not stop the rest of the batch; the next run moves on to other
   * attempts.
   */
  readonly reconcileRefunds: (input: {
    readonly limit: number;
  }) => Effect.Effect<
    PaymentRefundReconciliationSummary,
    EffectDrizzleQueryError | SqlError.SqlError
  >;
}

/**
 * How long after creating a paid attempt that nobody marked for refund the
 * batch keeps checking Nexi for a back-office refund, including the rest of a
 * partial refund. Nexi sends no notification for back-office refunds, so an
 * older payment's refund is recorded only once an operator cancellation marks
 * it as required.
 */
const unrequestedRefundCheckWindow = Temporal.Duration.from({
  hours: 30 * 24,
});

/**
 * How long the batch waits before checking the same attempt again, so a
 * quiet period does not re-read every eligible order on every run.
 */
const refundRecheckInterval = Temporal.Duration.from({ hours: 6 });

const toRefundedAt = (
  value: string | undefined,
  fallback: Temporal.Instant
) => {
  if (!value) return fallback;
  try {
    return Temporal.Instant.from(value);
  } catch {
    return fallback;
  }
};

export class PaymentRefundService extends Context.Service<
  PaymentRefundService,
  IPaymentRefundService
>()("@deskohub-workspace/checkout/PaymentRefundService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const nexi = yield* NexiService;
      const refunds = yield* PaymentRefundRepository;

      const reconcileAttempt = Effect.fn(
        "PaymentRefundService.reconcileAttempt"
      )(
        function* ({ attempt, correlationId }: RefundablePaymentAttempt) {
          const order = yield* nexi.getOrder({
            orderId: attempt.providerOrderId,
            correlationId,
          });
          const refund = summarizeNexiRefunds(order.operations);
          if (!refund) {
            yield* Effect.logInfo("Nexi reports no successful refund yet");
            return "no_refund" as const;
          }
          yield* Effect.annotateLogsScoped({ refund });

          const recordedAt = Temporal.Now.instant();
          const result = yield* refunds.recordRefund({
            id: attempt.id,
            refundedAmountValue: refund.amount,
            refundedAt: toRefundedAt(refund.lastRefundedAt, recordedAt),
            recordedAt,
          });
          yield* Effect.annotateLogsScoped({ result });
          if (result === "not_applicable") {
            yield* Effect.logWarning(
              "Nexi refund found for an attempt that cannot record it"
            );
          } else {
            yield* Effect.logInfo("Nexi refund reconciled");
          }
          return result;
        },
        (effect, input) =>
          effect.pipe(
            Effect.mapError(
              (cause) =>
                new PaymentRefundReconciliationError({
                  message: "Nexi refund reconciliation failed.",
                  cause,
                })
            ),
            Effect.scoped,
            Effect.annotateLogs({
              paymentAttemptId: input.attempt.id,
              providerOrderId: input.attempt.providerOrderId,
            })
          )
      );

      const reconcileRefunds = Effect.fn(
        "PaymentRefundService.reconcileRefunds"
      )(function* (input: { readonly limit: number }) {
        const checkedAt = Temporal.Now.instant();
        const candidates = yield* refunds.claimRefundChecks({
          limit: input.limit,
          checkedAt,
          lastCheckedBefore: checkedAt.subtract(refundRecheckInterval),
          recentPaymentsSince: checkedAt.subtract(unrequestedRefundCheckWindow),
        });
        const results = yield* Effect.forEach(
          candidates,
          (candidate) =>
            reconcileAttempt(candidate).pipe(
              Effect.tapError((cause) =>
                Effect.logError("Nexi refund reconciliation failed", { cause })
              ),
              Effect.orElseSucceed(() => "failed" as const)
            ),
          { concurrency: 4 }
        );
        const summary: PaymentRefundReconciliationSummary = {
          checked: results.length,
          recorded: results.filter((result) => result === "recorded").length,
          failed: results.filter((result) => result === "failed").length,
        };
        yield* Effect.logInfo("Nexi refund reconciliation batch completed", {
          summary,
        });
        return summary;
      });

      return PaymentRefundService.of({
        reconcileAttempt,
        reconcileRefunds,
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(PaymentRefundRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceNexiLayer)
  );
}
