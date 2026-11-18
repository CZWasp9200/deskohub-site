import { describe, expect, test } from "bun:test";
import {
  accessPinBox,
  accessPinBoxSize,
  accessPinGroups,
  wideAccessPinBox,
} from "./access-pin-groups";

// Synthetic digits only: a real PIN never appears in a test.
const digits = (length: number) => "1234567890".repeat(2).slice(0, length);

describe("accessPinGroups", () => {
  test("groups each PIN length the lock issues into groups of three or four", () => {
    expect([7, 8, 9].map((length) => accessPinGroups(digits(length)))).toEqual([
      ["123", "4567"],
      ["1234", "5678"],
      ["123", "456", "789"],
    ]);
  });

  test("puts the shorter groups first and keeps every digit in order", () => {
    for (let length = 1; length <= 16; length += 1) {
      const groups = accessPinGroups(digits(length));
      const sizes = groups.map((group) => group.length);
      expect(groups.join("")).toBe(digits(length));
      expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect([...sizes].sort()).toEqual(sizes);
    }
  });

  test("keeps a short code in one group", () => {
    expect(accessPinGroups(digits(4))).toEqual(["1234"]);
  });
});

describe("accessPinBoxSize", () => {
  const lineWidth = (groups: ReadonlyArray<string>, width: number) => {
    const count = groups.join("").length;
    return (
      count * width +
      (count - groups.length) * accessPinBox.digitGap +
      (groups.length - 1) * accessPinBox.groupGap
    );
  };
  // A 360 dp screen less its two 16 dp gutters.
  const narrow = 328;

  test("keeps the board's 40 dp box for seven digits at 360 dp", () => {
    expect(accessPinBoxSize(accessPinGroups(digits(7)), narrow, 1)).toEqual({
      width: 40,
      height: 60,
      fontSize: 36,
      radius: 12,
    });
  });

  test("at the default font size every length the lock issues fits one line at 360 dp", () => {
    for (const length of [7, 8, 9]) {
      const groups = accessPinGroups(digits(length));
      const size = accessPinBoxSize(groups, narrow, 1);
      expect(lineWidth(groups, size.width)).toBeLessThanOrEqual(narrow);
      expect(size.fontSize).toBeGreaterThanOrEqual(24);
    }
  });

  test("at 200% font size the digits grow, and each group still fits a line at 360 dp", () => {
    for (const length of [7, 8, 9]) {
      const groups = accessPinGroups(digits(length));
      const size = accessPinBoxSize(groups, narrow, 2);
      for (const group of groups) {
        expect(lineWidth([group], size.width)).toBeLessThanOrEqual(narrow);
      }
      expect(size.fontSize).toBeGreaterThanOrEqual(accessPinBox.fontSize * 1.5);
    }
  });

  test("grows with the font size where the width allows", () => {
    const groups = accessPinGroups(digits(7));
    const wide = accessPinBoxSize(groups, 800, 2);
    expect(wide.width).toBe(80);
    expect(wide.fontSize).toBe(72);
  });

  test("uses the approved tile size when the groups fit the wide card", () => {
    expect(accessPinBoxSize(accessPinGroups(digits(6)), 436, 1, true)).toEqual({
      width: 64,
      height: 84,
      fontSize: 48,
      radius: 14,
    });
  });

  test("keeps each group in the measured card at 200% text size", () => {
    for (const length of [7, 8, 9]) {
      const groups = accessPinGroups(digits(length));
      const pane = 380;
      const size = accessPinBoxSize(groups, pane, 2, true);
      for (const group of groups) {
        const width =
          group.length * size.width +
          (group.length - 1) * wideAccessPinBox.digitGap;
        expect(width).toBeLessThanOrEqual(pane);
      }
      expect(size.fontSize).toBeGreaterThan(wideAccessPinBox.fontSize);
    }
  });
});
