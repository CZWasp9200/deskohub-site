export const workspaceE2ENonPaymentCaseIds = [
  "locale-switch",
  "contact-form",
  "reservation-replacement",
  "checkout-zero-total",
  "calendar-sale-pricing-changes",
  "checkout-meeting-room-zero-total-four-hours",
  "meeting-room-reservation-replacement",
  "reservation-link-meeting-room-zero-total-en-US",
  "reservation-link-meeting-room-zero-total-cs-CZ",
  "reservation-link-meeting-room-unknown-code-en-US",
  "discount-code-expires-before-payment",
  "customer-discount-changes-before-payment",
  "discount-code-invalid-syntax",
  "discount-code-unknown",
  "discount-code-inactive",
  "discount-code-not-started",
  "discount-code-expired",
  "discount-code-customer-ineligible",
  "discount-code-product-ineligible",
  "discount-code-capacity-reached",
  "discount-code-already-redeemed",
  "voucher-reuse-and-exhaustion",
] as const;

// Serial hosted-payment lanes, balanced on median deployed case durations.
export const workspaceE2EPaymentCaseLanes = [
  [
    "payment-meeting-room-cancelled",
    "payment-late-recovery-recreated",
    "checkout-cowork-basic",
    "checkout-meeting-room-paid-one-hour",
    "checkout-office-paid-multi-day",
    "checkout-discount-code",
  ],
  [
    "payment-failed",
    "payment-cancelled",
    "payment-late-recovery-refund-required",
    "checkout-customer-discount-and-code",
    "checkout-calendar-sale",
    "checkout-customer-discount",
  ],
  [
    "checkout-calendar-sale-and-code",
    "checkout-meeting-room-paid-whole-day",
    "checkout-calendar-and-customer-discount",
    "checkout-all-discounts",
    "checkout-voucher-full-usage",
  ],
] as const;

export const workspaceE2ECaseIds = [
  ...workspaceE2ENonPaymentCaseIds,
  ...workspaceE2EPaymentCaseLanes.flat(),
] as const;

export type WorkspaceE2ECaseId = (typeof workspaceE2ECaseIds)[number];

export const isWorkspaceE2ECaseId = (
  value: string
): value is WorkspaceE2ECaseId =>
  (workspaceE2ECaseIds as readonly string[]).includes(value);
