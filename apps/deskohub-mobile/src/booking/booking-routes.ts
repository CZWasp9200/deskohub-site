import type {
  CustomerBookedSelection,
  CustomerBookingSelection,
  CustomerReservationProduct,
} from "@deskohub/workspace-customer-api";
import type { CheckoutRestartReason } from "./checkout/booking-problem";

type BookingFamily = CustomerBookingSelection["family"];

/** The family screen's route, optionally saying why the booking restarted. */
export const bookFamilyHref = (
  family: BookingFamily,
  restart?: CheckoutRestartReason
) =>
  restart === undefined
    ? (`/book/${family}` as const)
    : (`/book/${family}?restart=${restart}` as const);

export const bookCheckoutHref = "/book/checkout" as const;

/** The Book tab's choice of spaces. */
export const bookHref = "/book" as const;

/**
 * Account › Profile over the checkout, in the book stack, so back returns to
 * the checkout with its details.
 */
export const bookProfileHref = "/book/profile" as const;

/** The Reservations list (#991's reservations index). */
export const reservationsHref = "/reservations" as const;

/** The status screen a finished checkout opens (#991's reservations route). */
/** An order's booking ticket, as the Reservations list opens it. */
export const orderStatusHref = (orderId: string) =>
  `/reservations/${encodeURIComponent(orderId)}` as const;

export const paymentStatusHref = (orderId: string) =>
  `/reservations/${encodeURIComponent(orderId)}?after=payment` as const;

/**
 * Where "Book again" leads: the booked kind of space, or the choice of
 * spaces when the booking can no longer be booked as it was. The family
 * screens don't take a preselection yet, so the stored selection only picks
 * the screen.
 */
export const bookAgainHref = (booked: CustomerBookedSelection | undefined) =>
  booked === undefined ? bookHref : bookFamilyHref(booked.selection.family);

/**
 * Booking the same kind of space as a reservation, for Book again where
 * only its kind is known; a kind the app doesn't book leads to Book.
 */
export const bookKindHref = (
  kind: CustomerReservationProduct["kind"] | undefined
) => (kind === undefined || kind === "other" ? bookHref : bookFamilyHref(kind));
