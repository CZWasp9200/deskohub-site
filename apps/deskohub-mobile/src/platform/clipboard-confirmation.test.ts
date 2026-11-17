import { describe, expect, test } from "bun:test";
import { systemConfirmsCopy } from "./clipboard-confirmation";

describe("systemConfirmsCopy", () => {
  const cases: ReadonlyArray<[string, string | number, boolean]> = [
    ["android", 33, true],
    ["android", 35, true],
    ["android", 32, false],
    ["ios", "18.2", false],
    ["web", "", false],
  ];
  test.each(cases)("%s %s: %s", (OS, Version, expected) => {
    expect(systemConfirmsCopy({ OS, Version })).toBe(expected);
  });
});
