import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";

/**
 * Statuses whose checkout holds no live paid reservation, plus a fulfilled
 * one, which may be booked again for another visit. Any other status, a new
 * one included, keeps the customer on recovery instead of a second purchase.
 */
const newReservationStatuses: ReadonlySet<CheckoutStatusKind> =
  new Set<CheckoutStatusKind>([
    "not_found",
    "created",
    "pending",
    "payment_failed",
    "cancelled",
    "expired",
    "late_payment_refund",
    "fulfilled",
  ]);

export const shouldOfferNewReservation = (status: CheckoutStatusKind) =>
  newReservationStatuses.has(status);
