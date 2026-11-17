import { describe, expect, test } from "bun:test";
import { formatBasisPoints } from "./percent-format";

describe("formatBasisPoints", () => {
  test("reads basis points as the locale's percentage", () => {
    expect(formatBasisPoints(2000, "en-US")).toBe(
      new Intl.NumberFormat("en-US", { style: "percent" }).format(0.2)
    );
  });

  test("keeps a fractional percentage", () => {
    expect(formatBasisPoints(1250, "en-US")).toContain("12.5");
  });
});
