import { randomUUID } from "node:crypto";
import { buildCheckoutPayPath } from "@/features/checkout/backend/checkout";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import { defaultLocale, isLocale, type Locale } from "@/features/i18n";

/**
 * The Pay state a discount-code change left as it was, with the field error
 * to show for it. Server Action arguments are client-controlled, so never
 * build a redirect path from an unvalidated locale segment.
 */
export const getDiscountCodeRejectedPayPath = (
  locale: Locale,
  payStateToken: string,
  rejection: DiscountCodeRejection
) =>
  buildCheckoutPayPath(
    isLocale(locale) ? locale : defaultLocale,
    payStateToken,
    {
      discountCodeError: rejection,
      discountCodeErrorId: randomUUID(),
    }
  );
