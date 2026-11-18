import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { DateTime, Effect } from "effect";
import { Atom } from "effect/reactivity";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { shareTemporaryFile } from "../../customer-api/share-temporary-file";

/** A booking as a calendar event. */
export interface BookingEvent {
  readonly orderId: CustomerReservationOrderId;
  readonly title: string;
  readonly start: DateTime.Utc;
  /** Exclusive, as the booking's end. */
  readonly end: DateTime.Utc;
  readonly location: string | undefined;
}

// RFC 5545 text: backslash, semicolon, comma and line breaks are escaped.
const escapeText = (text: string) =>
  text.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");

const utcStamp = (instant: DateTime.Utc) =>
  DateTime.formatIso(instant)
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "");

// Lines fold at 75 octets; 60 characters stay under it for any UTF-8 text.
const fold = (line: string) => {
  const chars = Array.from(line);
  const parts: Array<string> = [];
  for (let at = 0; at < chars.length; at += 60) {
    parts.push(chars.slice(at, at + 60).join(""));
  }
  return parts.join("\r\n ");
};

/**
 * The booking as an iCalendar file with one event, in UTC. Its UID is the
 * order's, so importing it again updates the same event.
 */
export const bookingCalendarFile = (
  event: BookingEvent,
  now: DateTime.Utc
): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Deskohub//Workspace app//EN",
    "BEGIN:VEVENT",
    `UID:${escapeText(event.orderId)}@deskohub-workspace`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.location === undefined
      ? []
      : [`LOCATION:${escapeText(event.location)}`]),
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n")
    .concat("\r\n");

/** Hands the booking's calendar event to the share sheet (a download on the web). */
export const shareBookingEvent = (event: BookingEvent) =>
  Effect.flatMap(DateTime.now, (now) =>
    shareTemporaryFile({
      name: `reservation-${event.orderId}.ics`,
      mimeType: "text/calendar",
      bytes: new TextEncoder().encode(bookingCalendarFile(event, now)),
    })
  );

/** The booking's calendar share action and its last outcome. */
export const calendarShareAtom = Atom.family(
  (_orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn((event: BookingEvent) => shareBookingEvent(event))
);
