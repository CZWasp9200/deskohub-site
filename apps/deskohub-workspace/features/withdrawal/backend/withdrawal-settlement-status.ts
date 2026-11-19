import {
  type ContractWithdrawal,
  type WithdrawalSettlementStep,
  withdrawalSettlementSteps,
  withdrawalStepDoneAt,
} from "./withdrawal.repository";

/**
 * How far a withdrawal's settlement got, as operators see it: `settled` once
 * every step is done, `needs_attention` while a step that failed is being
 * retried on its own, else `in_progress`. `failingSteps` names each failing
 * step and its last failure code, in settlement order.
 */
export type WithdrawalSettlementStatus = {
  readonly settlement: "settled" | "in_progress" | "needs_attention";
  readonly failingSteps: readonly {
    readonly step: WithdrawalSettlementStep;
    readonly failureCode: string;
  }[];
};

export const getWithdrawalSettlementStatus = (
  withdrawal: Pick<
    ContractWithdrawal,
    | "settledAt"
    | "stepRetries"
    | "receiptSentAt"
    | "operatorNotifiedAt"
    | "contractCancelledAt"
  >
): WithdrawalSettlementStatus => {
  if (withdrawal.settledAt) return { settlement: "settled", failingSteps: [] };
  const failingSteps = withdrawalSettlementSteps.flatMap((step) => {
    const { failureCode } = withdrawal.stepRetries[step];
    return failureCode && !withdrawalStepDoneAt(withdrawal, step)
      ? [{ step, failureCode }]
      : [];
  });
  return {
    settlement: failingSteps.length > 0 ? "needs_attention" : "in_progress",
    failingSteps,
  };
};
