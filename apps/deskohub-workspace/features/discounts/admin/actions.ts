"use server";

import { Effect, Layer } from "effect";
import { m } from "@/features/administration/i18n";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import {
  type DiscountAdminMutation,
  discountAdminMutationStandardSchema,
} from "./contracts";
import {
  DiscountOperations,
  DiscountRequestLedger,
  discountOperationSettlements,
} from "./discount-operations.service";
import { getDiscountMutationFailureMessage } from "./mutation-error-message";

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.discountsActionTimedOut,
  unexpected: m.discountsActionFailedUnexpectedly,
};

const discountAdminMutationNotices = {
  "create-discount": m.discountsNoticeDiscountCreated,
  "update-discount": m.discountsNoticeDiscountUpdated,
  "delete-discount": m.discountsNoticeDiscountDeleted,
  "create-code": m.discountsNoticeCodeCreated,
  "create-customer-code": m.discountsNoticeCustomerCodeCreated,
  "update-code": m.discountsNoticeCodeUpdated,
  "delete-code": m.discountsNoticeCodeDeleted,
  "add-code-customer": m.discountsNoticeCodeCustomerAdded,
  "remove-code-customer": m.discountsNoticeCodeCustomerRemoved,
  "make-code-unrestricted": m.discountsNoticeCodeMadeUnrestricted,
  "create-voucher": m.discountsNoticeVoucherCreated,
  "create-customer-voucher": m.discountsNoticeCustomerVoucherCreated,
  "update-voucher": m.discountsNoticeVoucherUpdated,
  "delete-voucher": m.discountsNoticeVoucherDeleted,
  "add-voucher-customer": m.discountsNoticeVoucherCustomerAdded,
  "remove-voucher-customer": m.discountsNoticeVoucherCustomerRemoved,
  "make-voucher-unrestricted": m.discountsNoticeVoucherMadeUnrestricted,
  "set-customer-discount-group": m.discountsNoticeCustomerDiscountGroupUpdated,
} satisfies Record<
  DiscountAdminMutation["kind"],
  typeof m.discountsNoticeDiscountCreated
>;

const discountAdminMutationAction = defineAdministrationAction(
  {
    operation: "discount-administration.mutate",
    failureCopy,
    schema: discountAdminMutationStandardSchema,
    capabilities: Layer.mergeAll(
      DiscountOperations.Live,
      DiscountRequestLedger.unscoped
    ),
    publicFailure: getDiscountMutationFailureMessage,
    ...discountOperationSettlements.mutateDiscounts,
  },
  (input, { locale }) =>
    Effect.flatMap(DiscountOperations, (operations) =>
      operations.invoke("mutateDiscounts", input)
    ).pipe(
      Effect.map((result) => ({
        ...(result.createdDiscountId && {
          createdDiscountId: result.createdDiscountId,
        }),
        notice: discountAdminMutationNotices[input.kind]({}, { locale }),
      }))
    )
);

export const mutateDiscountAdmin: typeof discountAdminMutationAction = async (
  ...args: Parameters<typeof discountAdminMutationAction>
) => {
  "use server";
  return await discountAdminMutationAction(...args);
};
