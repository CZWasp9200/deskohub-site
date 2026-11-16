import { describe, expect, test } from "bun:test";
import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { DateTime } from "effect";
import { bookingCalendarFile } from "./calendar-event";

const event = {
  orderId: CustomerReservationOrderId.make("order-1"),
  title: "Desk; with, extras\\",
  start: DateTime.makeUnsafe("2026-11-25T23:00:00Z"),
  end: DateTime.makeUnsafe("2026-11-26T16:00:00Z"),
  location: "A street 1, City",
};
const now = DateTime.makeUnsafe("2026-11-10T08:30:15.123Z");
const lines = (file: string) => file.split("\r\n");

describe("bookingCalendarFile", () => {
  test("is one event in UTC, keyed by the order", () => {
    const file = bookingCalendarFile(event, now);
    expect(file.endsWith("\r\n")).toBe(true);
    expect(lines(file)).toEqual(
      expect.arrayContaining([
        "BEGIN:VEVENT",
        "UID:order-1@deskohub-workspace",
        "DTSTAMP:20261110T083015Z",
        "DTSTART:20261125T230000Z",
        "DTEND:20261126T160000Z",
        "END:VEVENT",
      ])
    );
  });

  test("escapes text values", () => {
    const file = bookingCalendarFile(event, now);
    expect(lines(file)).toContain("SUMMARY:Desk\\; with\\, extras\\\\");
    expect(lines(file)).toContain("LOCATION:A street 1\\, City");
  });

  test("leaves the place out when unknown, and folds long lines", () => {
    const file = bookingCalendarFile(
      { ...event, location: undefined, title: "x".repeat(130) },
      now
    );
    expect(file).not.toContain("LOCATION:");
    for (const line of lines(file)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
