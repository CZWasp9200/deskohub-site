import { describe, expect, test } from "bun:test";
import {
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
});
