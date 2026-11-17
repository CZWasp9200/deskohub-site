import { isNexiRefundOperation } from "./refunds";
import type { NexiOperation } from "./types";

/** Results of a payment that was refused or abandoned and moved no money. */
const declinedOperationResults = new Set([
  "DECLINED",
  "DENIED_BY_RISK",
  "DENIED",
  "THREEDS_FAILED",
  "FAILED",
  "CANCELED",
]);

/** Operation and order results that mean a payment did not go through. */
const failureOperationResults = new Set([
  ...declinedOperationResults,
  "VOIDED",
  "REFUNDED",
]);

const paymentOperationTypes = new Set(["AUTHORIZATION", "CAPTURE"]);

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

/**
 * Whether the operation is an authorization or capture that was refused or
 * abandoned, so it moved no money. A void, a refund, any other operation
 * type, and a missing or unrecognized result are not: they say money moved
 * or may still move.
 */
export const isDeclinedNexiPaymentOperation = (
  operation: Pick<NexiOperation, "operationType" | "operationResult">
) =>
  paymentOperationTypes.has(operation.operationType?.toUpperCase() ?? "") &&
  declinedOperationResults.has(operation.operationResult?.toUpperCase() ?? "");
