import { defineOperations, mutation } from "./administration-operation-port";
import {
  AdministrationDiscountMutation,
  AdministrationDiscountMutationResult,
} from "./workspace-admin-api";

/**
 * The discount operation group. One operation applies any discount, code,
 * voucher, audience, or customer discount group mutation; a retried
 * administration API request replays its first result.
 */
export const discountOperations = defineOperations({
  mutateDiscounts: mutation({
    input: AdministrationDiscountMutation,
    output: AdministrationDiscountMutationResult,
    ledger: true,
  }),
});
export type DiscountOperations = typeof discountOperations;
