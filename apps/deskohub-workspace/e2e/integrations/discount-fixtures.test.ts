import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { getWorkspaceProductByTier } from "../../features/checkout/product-catalog";
import {
  callsNamed,
  identifierNames,
  methodCallsNamed,
  parseTrackedSource,
  stringLiterals,
} from "../../scripts/shared/source-ast";
import { calendarDiscountExpectation } from "../cases/discounts";
import { discountCodeFixtures } from "./discount-fixtures";

const parseFixtureModule = () =>
  parseTrackedSource(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url))
  );

test("expires a code beyond cross-host clock skew", () => {
  const { ast } = parseFixtureModule();

  // The pinned expiry is one fixed instant, never a wall-clock subtraction.
  const fixedInstants = methodCallsNamed(ast, "from").filter(
    (call) =>
      call.callee.type === "MemberExpression" &&
      call.callee.object.type === "MemberExpression" &&
      call.callee.object.object.type === "Identifier" &&
      call.callee.object.object.name === "Temporal" &&
      stringLiterals(call).some(
        (literal) => literal.value === "2000-01-01T00:00:00Z"
      )
  );
  expect(fixedInstants).toHaveLength(1);
  const nowSubtractions = callsNamed(ast, "subtract").filter((call) =>
    identifierNames(call).has("instant")
  );
  expect(nowSubtractions).toHaveLength(0);
});

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
