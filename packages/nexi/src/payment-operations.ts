import { isNexiRefundOperation } from "./refunds";
import type { NexiOperation } from "./types";

/** Operation and order results that mean a payment did not go through. */
const failureOperationResults = new Set([
  "DECLINED",
  "DENIED_BY_RISK",
  "DENIED",
  "THREEDS_FAILED",
  "FAILED",
  "CANCELED",
  "VOIDED",
  "REFUNDED",
]);

/** Whether a Nexi operation or order status is a failure result, in any case. */
export const isNexiFailureResult = (status: string | undefined) =>
  status ? failureOperationResults.has(status.toUpperCase()) : false;

/**
 * Whether the operation is a payment that failed. A refund's result describes
 * money going back, not the payment outcome: a back-office refund before
 * settlement reports `VOIDED`, which must never read as a failed payment.
 */
export const isFailedNexiPaymentOperation = (
  operation: Pick<NexiOperation, "operationType" | "operationResult">
) =>
  !isNexiRefundOperation(operation) &&
  isNexiFailureResult(operation.operationResult);
