import type { CustomerReservationProduct } from "@/features/account/contracts";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";

/**
 * The catalog name of what a reservation in the account history books, in
 * `locale`, and the history's own name for a product it can't tell.
 */
export const getReservationProductName = (
  product: CustomerReservationProduct,
  locale: Locale
) => {
  switch (product.kind) {
    case "cowork":
      return getWorkspaceProductTierTitle(product.tier, locale);
    case "meeting-room":
      return getWorkspaceMeetingRoomProductTitle(locale);
    case "office":
      return getWorkspaceOfficeProductTitle(locale);
    case "other":
      return m.accountReservationOtherProduct({}, { locale });
  }
};
