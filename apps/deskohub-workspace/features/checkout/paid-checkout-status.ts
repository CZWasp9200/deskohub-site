import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";

const paidCheckoutStatuses = {
  not_found: false,
  created: false,
  pending: false,
  payment_pending_delayed: false,
  paid_waiting_fulfillment: true,
  paid_fulfillment_delayed: true,
  paid_awaiting_delivery: true,
  paid_delivery_delayed: true,
  fulfilled: true,
  fulfillment_failed: true,
  payment_failed: false,
  cancelled: false,
  expired: false,
  late_payment_checking: false,
  late_payment_refund: false,
  late_payment_review: false,
} as const satisfies Record<CheckoutStatusKind, boolean>;

/**
 * Whether the order is locally paid. A late payment counts only once its
 * recovery confirms the reservation.
 */
export const isPaidCheckoutStatus = (status: CheckoutStatusKind) =>
  paidCheckoutStatuses[status];
