import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";

/**
 * Statuses whose checkout holds no live paid reservation and no payment that
 * could still settle, plus a fulfilled one, which may be booked again for
 * another visit. Any other status, a new one included, keeps the customer on
 * recovery instead of a second purchase.
 */
const newReservationStatuses: ReadonlySet<CheckoutStatusKind> =
  new Set<CheckoutStatusKind>([
    "not_found",
    "created",
    "payment_failed",
    "cancelled",
    "expired",
    "late_payment_refund",
    "fulfilled",
  ]);

export const shouldOfferNewReservation = (status: CheckoutStatusKind) =>
  newReservationStatuses.has(status);
