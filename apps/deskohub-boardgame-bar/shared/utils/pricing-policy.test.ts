import { expect, test } from "bun:test";
import { formatEntranceFeeTiersStartDate } from "./pricing-policy";

test("formats the tiers start date as the local calendar day in every locale", () => {
  expect(formatEntranceFeeTiersStartDate("en-US")).toBe("January 1, 2027");
  expect(formatEntranceFeeTiersStartDate("cs-CZ")).toBe("1. ledna 2027");
});
