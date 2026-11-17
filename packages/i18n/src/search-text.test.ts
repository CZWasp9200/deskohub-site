import { describe, expect, test } from "bun:test";
import { foldSearchText, includesSearchText } from "./search-text";

describe("foldSearchText", () => {
  test("lower-cases and drops accents, whatever the script", () => {
    expect(foldSearchText("Česko Österreich Việt Nam")).toBe(
      "cesko osterreich viet nam"
    );
    expect(foldSearchText("УКРАЇНА")).toBe(foldSearchText("україна"));
  });
});

describe("includesSearchText", () => {
  test("matches ignoring case and accents", () => {
    expect(includesSearchText("Jarní výprodej 2026", "VYPRODEJ")).toBe(true);
    expect(includesSearchText("Spring sale", "  sale ")).toBe(true);
    expect(includesSearchText("Україна", "украї")).toBe(true);
  });

  test("rejects text that doesn't contain the search", () => {
    expect(includesSearchText("Spring sale", "winter")).toBe(false);
  });
});
