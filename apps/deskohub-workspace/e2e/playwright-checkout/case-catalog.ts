// Cases that never open a Nexi hosted payment, longest median deployed
// duration first.
export const workspaceE2ENonPaymentCaseIds = [
  "voucher-reuse-and-exhaustion",
  "discount-code-capacity-reached",
  "reservation-link-meeting-room-zero-total-en-US",
  "discount-code-already-redeemed",
  "checkout-meeting-room-zero-total-four-hours",
  "reservation-replacement",
  "meeting-room-reservation-replacement",
  "checkout-zero-total",
  "calendar-sale-pricing-changes",
  "reservation-link-meeting-room-unknown-code-en-US",
  "reservation-link-meeting-room-zero-total-cs-CZ",
  "discount-code-expires-before-payment",
  "customer-discount-changes-before-payment",
  "locale-switch",
  "discount-code-unknown",
  "discount-code-inactive",
  "discount-code-expired",
  "discount-code-not-started",
  "discount-code-customer-ineligible",
  "discount-code-product-ineligible",
  "contact-form",
  "discount-code-invalid-syntax",
] as const;

// Cases that pay on the Nexi hosted page, longest median deployed duration
// first. Only their hosted-payment portion holds the run's hosted-payment
// permit.
const workspaceE2EPaidCaseIds = [
  "checkout-calendar-sale-and-code",
  "checkout-calendar-sale",
  "payment-late-recovery-recreated",
  "checkout-meeting-room-paid-one-hour",
  "checkout-customer-discount-and-code",
  "checkout-meeting-room-paid-whole-day",
  "checkout-calendar-and-customer-discount",
  "checkout-cowork-basic",
  "checkout-all-discounts",
  "checkout-office-paid-multi-day",
  "payment-late-recovery-refund-required",
  "checkout-voucher-full-usage",
  "checkout-customer-discount",
  "checkout-discount-code",
  "payment-failed",
  "payment-meeting-room-cancelled",
  "payment-cancelled",
] as const;

export const workspaceE2ECaseIds = [
  ...workspaceE2ENonPaymentCaseIds,
  ...workspaceE2EPaidCaseIds,
] as const;

export type WorkspaceE2ECaseId = (typeof workspaceE2ECaseIds)[number];

// Playwright admits the case pool in registration order. Alternating paid and
// non-payment cases, each longest first, keeps about three hosted sessions in
// demand at a time, so case workers rarely wait for the hosted-payment permit.
export const workspaceE2ECasePoolOrder: readonly WorkspaceE2ECaseId[] =
  Array.from(
    {
      length: Math.max(
        workspaceE2EPaidCaseIds.length,
        workspaceE2ENonPaymentCaseIds.length
      ),
    },
    (_, index) => [
      workspaceE2EPaidCaseIds[index],
      workspaceE2ENonPaymentCaseIds[index],
    ]
  )
    .flat()
    .filter((caseId) => caseId !== undefined);

export const isWorkspaceE2ECaseId = (
  value: string
): value is WorkspaceE2ECaseId =>
  (workspaceE2ECaseIds as readonly string[]).includes(value);
