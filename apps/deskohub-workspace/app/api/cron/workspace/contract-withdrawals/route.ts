import { Effect } from "effect";
import { WithdrawalService } from "@/features/withdrawal/backend/withdrawal.service";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 300;

const cronBatchLimit = 25;

/**
 * Retries the unfinished settlement of customers' withdrawals: the receipt,
 * the operator notice and the contract's cancellation, whichever a run
 * couldn't finish. Each failure waits longer before its next run.
 */
export const GET = defineWorkspaceCron({
  operation: "contractWithdrawalSettlementCron",
  failureMessage: "Contract withdrawal settlement failed",
  input: () => ({ limit: cronBatchLimit }),
  run: Effect.fn("contractWithdrawalSettlementCron.run")(function* (input: {
    readonly limit: number;
  }) {
    const withdrawals = yield* WithdrawalService;
    return yield* withdrawals.settleDue(input);
  }, Effect.provide(WithdrawalService.Live)),
});
