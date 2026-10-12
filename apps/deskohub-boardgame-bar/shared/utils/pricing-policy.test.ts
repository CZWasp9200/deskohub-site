import { expect, test } from "bun:test";
import {
  ENTRANCE_FEE_TIERS_START_AT,
  ENTRANCE_FEE_TIERS_VISIBLE_AT,
  formatEntranceFeeTiersStartDate,
  getEntranceFeeTiersPhase,
} from "./pricing-policy";

test("keeps the current pricing quote before the announcement", () => {
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_VISIBLE_AT - 1)).toBe(
    "current"
  );
});

test("announces the tiers alongside the current pricing during the announcement month", () => {
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_VISIBLE_AT)).toBe(
    "announced"
  );
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_START_AT - 1)).toBe(
    "announced"
  );
});

test("quotes only the tiers once they take effect", () => {
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_START_AT)).toBe("active");
});

test("formats the tiers start date as the local calendar day in every locale", () => {
  expect(formatEntranceFeeTiersStartDate("en-US")).toBe("January 1, 2027");
  expect(formatEntranceFeeTiersStartDate("cs-CZ")).toBe("1. ledna 2027");
});
