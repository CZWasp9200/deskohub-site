import type { AdministrationOperationError } from "@deskohub/workspace-admin-api";
import type { Layer } from "effect";
import { m } from "@/features/administration/i18n";
import type { AdministratorUnauthorizedError } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import type { DiscountOperationFailureCode } from "./discount-operation-errors";
import type { DiscountOperations } from "./discount-operations.service";

const failureCopy = {
  "discount-not-found": m.discountsErrorDiscountMissing,
  "discount-code-not-found": m.discountsErrorCodeMissing,
  "voucher-not-found": m.discountsErrorVoucherMissing,
  "dotypos-customer-not-found": m.discountsErrorDotyposCustomerMissing,
  "dotypos-discount-group-not-found":
    m.discountsErrorDotyposDiscountGroupMissing,
  "code-audience-membership-not-found":
    m.discountsErrorCodeAudienceMembershipMissing,
  "voucher-audience-membership-not-found":
    m.discountsErrorVoucherAudienceMembershipMissing,
  "code-final-audience-customer": m.discountsErrorCodeFinalCustomer,
  "voucher-final-audience-customer": m.discountsErrorVoucherFinalCustomer,
  "promotion-code-taken": m.discountsErrorPromotionCodeTaken,
  "discount-referenced": m.discountsErrorDiscountReferenced,
  "discount-code-claimed": m.discountsErrorCodeClaimed,
  "voucher-claimed": m.discountsErrorVoucherClaimed,
  "voucher-credit-below-usage": m.discountsErrorVoucherCreditBelowUsage,
  "voucher-currency-locked": m.discountsErrorVoucherCurrencyLocked,
  "service-dates-invalid": m.discountsErrorServiceDatesInvalid,
} satisfies Record<
  DiscountOperationFailureCode,
  typeof m.discountsErrorSaveFailed
>;

const isFailureCode = (code: string): code is DiscountOperationFailureCode =>
  Object.hasOwn(failureCopy, code);

/**
 * The operator-facing message for a failed discount mutation, from the port
 * error's stable code. The port's messages stay English for the
 * administration API; any failure without a known code, such as an
 * unavailable dependency, gets the generic message.
 */
export const getDiscountMutationFailureMessage = (
  failure:
    | AdministrationOperationError
    | AdministratorUnauthorizedError
    | Layer.Error<typeof DiscountOperations.Live>,
  locale: Locale
): string =>
  ("code" in failure && isFailureCode(failure.code)
    ? failureCopy[failure.code]
    : m.discountsErrorSaveFailed)({}, { locale });
