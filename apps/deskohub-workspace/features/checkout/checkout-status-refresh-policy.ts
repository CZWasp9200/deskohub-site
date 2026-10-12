import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";

export const shouldAutoRefreshCheckoutStatus = (status: CheckoutStatusKind) =>
  status === "pending" ||
  status === "paid_waiting_fulfillment" ||
  status === "paid_awaiting_delivery" ||
  status === "late_payment_checking";
