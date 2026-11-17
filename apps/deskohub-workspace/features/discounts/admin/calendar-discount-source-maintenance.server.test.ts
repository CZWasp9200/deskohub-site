import { expect, test } from "bun:test";
import { discountMutationChangesCalendarSource } from "./calendar-discount-source-maintenance.server";

test.each([
  [{ kind: "create-discount" }, true],
  [{ kind: "update-discount" }, true],
  [{ kind: "delete-discount" }, true],
  [{ kind: "create-code", discount: { kind: "new" } }, true],
  [{ kind: "create-customer-code", discount: { kind: "new" } }, true],
  [{ kind: "create-code", discount: { kind: "existing" } }, false],
  [{ kind: "create-customer-code", discount: { kind: "existing" } }, false],
  [{ kind: "update-code" }, false],
  [{ kind: "delete-code" }, false],
  [{ kind: "add-code-customer" }, false],
  [{ kind: "remove-code-customer" }, false],
  [{ kind: "make-code-unrestricted" }, false],
  [{ kind: "create-voucher" }, false],
  [{ kind: "create-customer-voucher" }, false],
  [{ kind: "update-voucher" }, false],
  [{ kind: "delete-voucher" }, false],
  [{ kind: "add-voucher-customer" }, false],
  [{ kind: "remove-voucher-customer" }, false],
  [{ kind: "make-voucher-unrestricted" }, false],
  [{ kind: "set-customer-discount-group" }, false],
] as const)("detects source-changing mutation %#", (mutation, expected) => {
  expect(discountMutationChangesCalendarSource(mutation)).toBe(expected);
});
