import { type Locale, m } from "@/features/i18n";
import { type Money, moneyEquals } from "@/shared/money/money";
import type {
  AppliedDiscount,
  Discount,
  DiscountAdjustment,
} from "./contracts";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { getPromotionTiming } from "./promotion-code";
import type { DiscountClaimInstruction } from "./provider";

// Compares the benefit a payment attempt accepted with what its code or
// voucher claim may still grant, so claim admission refuses a benefit that
// changed meanwhile.

type VoucherClaim = Extract<
  DiscountClaimInstruction,
  { readonly kind: "voucher" }
>;

type PromotionTiming = ReturnType<typeof getPromotionTiming>;

export const discountAdjustmentsEqual = (
  left: DiscountAdjustment,
  right: DiscountAdjustment
) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "percentage" && right.kind === "percentage") {
    return left.basisPoints === right.basisPoints;
  }
  if (left.kind === "fixed" && right.kind === "fixed") {
    return moneyEquals(left.amount, right.amount);
  }
  return false;
};

/** Whether the accepted discount's deadline differs from the promotion's. */
export const promotionTimingChanged = (
  timing: PromotionTiming,
  discount: Discount
) =>
  timing.expiresAt !== discount.expiresAt ||
  timing.countdownStartsAt !== discount.countdownStartsAt;

/**
 * Whether the voucher's available credit differs from the accepted credit,
 * or the application takes more than is available.
 */
export const voucherCreditChanged = (input: {
  readonly claim: VoucherClaim;
  readonly application: AppliedDiscount;
  readonly availableAmount: Money;
}) => {
  const adjustment = input.application.discount.adjustment;
  return (
    !moneyEquals(input.availableAmount, input.claim.availableAmount) ||
    adjustment.kind !== "fixed" ||
    !moneyEquals(adjustment.amount, input.availableAmount) ||
    input.application.amount.value > input.availableAmount.value
  );
};

/** Whether the accepted voucher discount no longer presents this voucher. */
export const voucherPresentationChanged = (input: {
  readonly claim: VoucherClaim;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
  readonly timing: PromotionTiming;
}) =>
  input.application.discount.id !==
    deriveOpaqueDiscountId({
      providerNamespace: "database-voucher",
      providerReference: input.claim.voucherId,
    }) ||
  input.application.discount.label !==
    m.checkoutVoucherLabel({}, { locale: input.locale }) ||
  promotionTimingChanged(input.timing, input.application.discount);
