import { expect, test } from "bun:test";
import { upperFirst } from "./sentence-case";

test("upper-cases only the first letter, in the locale's rules", () => {
  expect(upperFirst("coffee, 4 hours", "en-US")).toBe("Coffee, 4 hours");
  expect(upperFirst("ďábel", "cs-CZ")).toBe("Ďábel");
  expect(upperFirst("", "en-US")).toBe("");
});
