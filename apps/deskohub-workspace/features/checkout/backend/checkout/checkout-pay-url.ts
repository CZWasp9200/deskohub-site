import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export const discountCodeErrorQueryParam = "discountCodeError" as const;
export const discountCodeErrorIdQueryParam = "discountCodeErrorId" as const;

/** What a Pay URL adds beside its token. */
export type CheckoutPayPathOptions = {
  readonly discountCodeError?: DiscountCodeRejection;
  readonly discountCodeErrorId?: string;
  readonly orderId?: WorkspaceReservationId;
};

/** The Pay page URL that continues with a sealed Pay state token. */
export const buildCheckoutPayPath = (
  locale: Locale,
  payStateToken: string,
  options: CheckoutPayPathOptions = {}
) => {
  const searchParams = new URLSearchParams({
    [payStateTokenQueryParam]: payStateToken,
  });
  if (options.orderId) {
    searchParams.set("orderId", options.orderId);
  }
  if (options.discountCodeError) {
    searchParams.set(discountCodeErrorQueryParam, options.discountCodeError);
  }
  if (options.discountCodeErrorId) {
    searchParams.set(
      discountCodeErrorIdQueryParam,
      options.discountCodeErrorId
    );
  }

  return `/${locale}/checkout/pay?${searchParams}`;
};
