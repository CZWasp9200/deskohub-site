import type { CalendarEvent } from "@/features/events/backend/events.server";
import type { RegistrationAvailability } from "@/features/events/components/registration-control";

/**
 * Decides which registration control an event shows. A customer who is
 * already registered keeps seeing that (and can cancel) even when the event
 * is full or registration has closed, until the event is over.
 */
export function registrationAvailability(
  event: Pick<
    CalendarEvent,
    | "startsAt"
    | "endsAt"
    | "capacity"
    | "registrationOpen"
    | "registrationCount"
    | "isRegistered"
  >,
  { signedIn, now }: { readonly signedIn: boolean; readonly now: Date }
): RegistrationAvailability {
  if ((event.endsAt ?? event.startsAt).getTime() < now.getTime()) return "past";
  if (event.isRegistered) return "registered";
  if (!event.registrationOpen) return "closed";
  if (event.capacity !== null && event.registrationCount >= event.capacity) {
    return "full";
  }
  return signedIn ? "open" : "signedOut";
}
