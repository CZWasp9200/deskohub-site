import type {
  AdministrationReservationWithdrawalType,
  AdministrationWithdrawalRetryResultType,
  AdministrationWorkspaceReservationIdType,
} from "@deskohub/workspace-admin-api";
import { Data, Effect, Option } from "effect";
import {
  type ContractWithdrawal,
  withdrawalSettlementSteps,
  withdrawalStepDoneAt,
} from "@/features/withdrawal/backend/withdrawal.repository";
import { WithdrawalService } from "@/features/withdrawal/backend/withdrawal.service";
import { getWithdrawalSettlementStatus } from "@/features/withdrawal/backend/withdrawal-settlement-status";

export const toAdministrationWithdrawal = (
  withdrawal: ContractWithdrawal
): AdministrationReservationWithdrawalType => ({
  submittedAt: withdrawal.submittedAt.toString(),
  paidAmount: withdrawal.paidAmount,
  refundAmount: withdrawal.refundAmount,
  refundBasis: withdrawal.refundBasis,
  settlement: getWithdrawalSettlementStatus(withdrawal).settlement,
  steps: withdrawalSettlementSteps.map((step) => {
    const doneAt = withdrawalStepDoneAt(withdrawal, step);
    const { attempts, failureCode, retryAt } = withdrawal.stepRetries[step];
    const unfinishedStatus = failureCode ? "failed" : "pending";
    return {
      step,
      status: doneAt ? "done" : unfinishedStatus,
      doneAt: doneAt?.toString() ?? null,
      attempts,
      failureCode: doneAt ? null : failureCode,
      retryAt: !doneAt && retryAt ? retryAt.toString() : null,
    };
  }),
});

/** The reservation has no customer withdrawal to retry. */
export class ReservationWithdrawalNotFoundError extends Data.TaggedError(
  "ReservationWithdrawalNotFoundError"
) {}

export const retryReservationWithdrawal = Effect.fn(
  "administration.retry-reservation-withdrawal"
)(function* (reservationId: AdministrationWorkspaceReservationIdType) {
  const withdrawals = yield* WithdrawalService;
  const answer = yield* withdrawals.settleNow({
    kind: "reservation",
    id: reservationId,
  });
  if (Option.isNone(answer)) {
    return yield* new ReservationWithdrawalNotFoundError();
  }
  return {
    outcome: answer.value.outcome,
    withdrawal: toAdministrationWithdrawal(answer.value.withdrawal),
  } satisfies AdministrationWithdrawalRetryResultType;
});
