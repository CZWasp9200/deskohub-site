import { describe, expect, test } from "bun:test";
import {
  noToast,
  toastAfter,
  toastBottomOffset,
  toastLook,
} from "./toast-presentation";
import { color, shadow, space } from "./tokens";

describe("toast state", () => {
  test("a toast is a confirmation unless it says otherwise", () => {
    const shown = toastAfter(noToast, {
      kind: "show",
      request: { message: "saved" },
    }).shown;
    expect(shown?.tone).toBe("confirmation");
    expect(
      toastAfter(noToast, {
        kind: "show",
        request: { message: "off", tone: "neutral" },
      }).shown?.tone
    ).toBe("neutral");
  });

  test("a new toast replaces the current one", () => {
    const first = toastAfter(noToast, {
      kind: "show",
      request: { message: "first" },
    });
    const second = toastAfter(first, {
      kind: "show",
      request: { message: "second" },
    });
    expect(second.shown?.message).toBe("second");
    expect(second.shown?.id).not.toBe(first.shown?.id);
  });

  test("a dismissal clears only the toast it names", () => {
    const first = toastAfter(noToast, {
      kind: "show",
      request: { message: "first" },
    });
    const second = toastAfter(first, {
      kind: "show",
      request: { message: "second" },
    });
    const firstId = first.shown?.id ?? -1;
    const secondId = second.shown?.id ?? -1;
    // The replaced toast's timer fires late: the new toast stays.
    expect(toastAfter(second, { kind: "dismiss", id: firstId })).toBe(second);
    expect(
      toastAfter(second, { kind: "dismiss", id: secondId }).shown
    ).toBeUndefined();
  });
});

describe("toast placement", () => {
  test("sits a gap above the bottom safe area", () => {
    expect(toastBottomOffset(24, [])).toBe(24 + space.md);
  });

  test("sits a gap above the tallest registered bottom chrome", () => {
    expect(toastBottomOffset(24, [80, 56])).toBe(80 + space.md);
  });

  test("chrome lower than the safe area doesn't pull it down", () => {
    expect(toastBottomOffset(24, [10])).toBe(24 + space.md);
  });
});

describe("toast look", () => {
  test("a confirmation is green with the check; a neutral toast navy without", () => {
    expect(toastLook("confirmation")).toEqual({
      backgroundColor: color.positiveInk,
      lift: shadow.toastConfirmation,
      checkIcon: true,
    });
    expect(toastLook("neutral")).toEqual({
      backgroundColor: color.navy,
      lift: shadow.toast,
      checkIcon: false,
    });
  });
});
