import { describe, expect, test } from "bun:test";
import {
  isDeclinedNexiPaymentOperation,
  isFailedNexiPaymentOperation,
  isNexiFailureResult,
} from "./payment-operations";

describe("Nexi payment operation results", () => {
  test("reads failure results in any case", () => {
    expect(isNexiFailureResult("declined")).toBe(true);
    expect(isNexiFailureResult("THREEDS_FAILED")).toBe(true);
    expect(isNexiFailureResult("EXECUTED")).toBe(false);
    expect(isNexiFailureResult("PENDING")).toBe(false);
    expect(isNexiFailureResult(undefined)).toBe(false);
  });

  test("a failed payment operation is never a refund", () => {
    expect(
      isFailedNexiPaymentOperation({
        operationType: "AUTHORIZATION",
        operationResult: "DECLINED",
      })
    ).toBe(true);
    expect(
      isFailedNexiPaymentOperation({
        operationType: "REFUND",
        operationResult: "VOIDED",
      })
    ).toBe(false);
    expect(
      isFailedNexiPaymentOperation({
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
      })
    ).toBe(false);
  });

  test("a declined payment operation is a refused authorization or capture only", () => {
    for (const operationResult of ["THREEDS_FAILED", "declined", "CANCELED"]) {
      expect(
        isDeclinedNexiPaymentOperation({
          operationType: "AUTHORIZATION",
          operationResult,
        })
      ).toBe(true);
    }
    for (const operation of [
      { operationType: "AUTHORIZATION", operationResult: "EXECUTED" },
      { operationType: "AUTHORIZATION", operationResult: "PENDING" },
      { operationType: "AUTHORIZATION", operationResult: "VOIDED" },
      { operationType: "AUTHORIZATION", operationResult: undefined },
      { operationType: "VOID", operationResult: "FAILED" },
      { operationType: "REFUND", operationResult: "DECLINED" },
      { operationType: undefined, operationResult: "DECLINED" },
    ]) {
      expect(isDeclinedNexiPaymentOperation(operation)).toBe(false);
    }
  });
});
