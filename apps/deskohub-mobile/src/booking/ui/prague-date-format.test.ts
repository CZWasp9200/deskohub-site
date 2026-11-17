import { afterEach, describe, expect, mock, test } from "bun:test";

// The device's clock setting, which the preload leaves unsaid (undefined).
let deviceClock: boolean | undefined;
mock.module("../../i18n/device-clock", () => ({
  deviceHour12: () => deviceClock,
}));

const { formatPragueDate, formatPragueTime } = await import(
  "./prague-date-format"
);

afterEach(() => {
  deviceClock = undefined;
});

const numericDate = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
} as const;

describe("formatPragueDate", () => {
  test("keeps the calendar day whatever the time zone", () => {
    expect(formatPragueDate("2026-12-31", "cs-CZ", numericDate)).toBe(
      "31. 12. 2026"
    );
    expect(formatPragueDate("2026-01-01", "en-US", numericDate)).toBe(
      "1/1/2026"
    );
  });
});

describe("formatPragueTime", () => {
  test("keeps the wall-clock time whatever the time zone", () => {
    expect(formatPragueTime("23:30", "cs-CZ")).toBe("23:30");
    expect(formatPragueTime("00:15", "cs-CZ")).toBe("0:15");
  });

  test("follows a 24-hour device in every language, midnight as 00", () => {
    deviceClock = false;
    for (const locale of ["en-US", "hi-IN", "vi-VN"] as const) {
      expect(formatPragueTime("14:00", locale)).toContain("14");
      expect(formatPragueTime("14:00", locale)).not.toContain("2");
      expect(formatPragueTime("00:00", locale)).not.toContain("24");
    }
  });

  test("follows a 12-hour device, as the tickets do", () => {
    deviceClock = true;
    for (const locale of ["en-US", "cs-CZ"] as const) {
      expect(formatPragueTime("14:00", locale)).not.toContain("14");
      expect(formatPragueTime("14:00", locale)).toContain("2");
    }
  });
});
