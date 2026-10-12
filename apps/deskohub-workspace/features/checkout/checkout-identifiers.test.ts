import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
  paymentAttemptIdSchema,
} from "./checkout-identifiers";

describe("checkout identifier schemas", () => {
  test.each([
    checkoutSessionIdSchema,
    checkoutAttemptIdSchema,
    paymentAttemptIdSchema,
  ])("rejects empty identifiers", (schema) => {
    expect(() => Schema.decodeUnknownSync(schema)("")).toThrow();
  });
});
