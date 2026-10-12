import { expect, test } from "bun:test";
import { getWorkspaceProductByTier } from "../../features/checkout/product-catalog";
import { calendarDiscountExpectation } from "../cases/discounts";
import { discountCodeFixtures } from "./discount-fixtures";

test("voucher credit covers two one-day Open Space checkouts after the Calendar sale", () => {
  const openSpacePrice = getWorkspaceProductByTier("open-space").price.value;
  const calendarSaleBasisPoints =
    calendarDiscountExpectation.adjustment.basisPoints;

  const perDateAfterSale =
    openSpacePrice -
    Math.floor((openSpacePrice * calendarSaleBasisPoints) / 10_000);
  expect(perDateAfterSale).toBe(
    Math.floor((openSpacePrice * (10_000 - calendarSaleBasisPoints)) / 10_000)
  );

  const expectedTwoDateTotal = perDateAfterSale * 2;
  expect(discountCodeFixtures.voucherReuse.creditPerRun.value).toBe(
    expectedTwoDateTotal
  );
});
