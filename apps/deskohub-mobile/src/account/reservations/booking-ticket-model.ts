import type {
  CustomerOrderPaymentStatus,
  CustomerOrderState,
  CustomerOrderStatus,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { AutomaticRefresh } from "./status-refresh-rules";

/**
 * The booking's status badge, always on the ticket: the app's reservation
 * statuses, plus "Not booked" for an order that ended without a booking.
 */
export type TicketBadgeKind =
  | "pending"
  | "confirmed"
  | "attention"
  | "cancelled"
  | "withdrawn"
  | "not-booked";

/** Why the header names a reason instead of the countdown. */
export type TicketReason =
  | "payment-failed"
  | "time-ran-out"
  | "cancelled"
  | "refund"
  | "email-late";

/** What the price line adds to the total. */
export type TicketPriceNote =
  | "none"
  | "paid"
  | "not-charged"
  | "being-refunded";

/** A step of a booking under way. */
export type TicketStepName =
  | "payment"
  | "confirm"
  | "pin"
  | "manual-check"
  | "booking-or-refund";

export type TicketStepState = "done" | "running" | "todo" | "warning";

export interface TicketStep {
  readonly name: TicketStepName;
  readonly state: TicketStepState;
  /** The step says what its warning means. */
  readonly explained: boolean;
}

/** The one action in the steps' stub. */
export type TicketStepsAction =
  /** Read the order again, once the screen stopped checking on its own. */
  | "check-again"
  | "contact"
  /** Reopen the payment page the customer left. */
  | "payment-page";

/** What stands under the perforation. */
export type TicketStub =
  | {
      readonly _tag: "Steps";
      readonly steps: ReadonlyArray<TicketStep>;
      readonly action: Option.Option<TicketStepsAction>;
    }
  | { readonly _tag: "AccessPin" }
  | { readonly _tag: "BookAgain"; readonly refundNote: boolean }
  /** Pay the same order again, its details kept. */
  | { readonly _tag: "RetryPayment" }
  /** Cancelled by the customer's withdrawal, its refund under way. */
  | { readonly _tag: "Withdrawn"; readonly refundAmount: Money };

/** What the booking view shows under the ticket. */
export type TicketFollowUp =
  /** Calendar, invoice and Contact us rows. */
  | "more-actions"
  /** A quiet Contact us link. */
  | "contact"
  | "none";

export interface BookingTicketModel {
  readonly badge: TicketBadgeKind;
  /** Shown in place of the countdown. */
  readonly reason: Option.Option<TicketReason>;
  readonly price: TicketPriceNote;
  readonly stub: TicketStub;
  readonly followUp: TicketFollowUp;
  /** The booking won't happen: its date tile reads quieter. */
  readonly dim: boolean;
}

/**
 * Whether the screen still checks a settling order on its own, or stopped
 * before it settled (the visit's reads ran out, the budget ran low, a read
 * failed).
 */
export type OrderChecking = "checking" | "stopped";

/**
 * How the customer can still pay an unpaid order: its payment page can be
 * opened again (the server's `paymentPageReopenable` on its latest read,
 * unless reopening was refused since), and a failed, cancelled or expired
 * payment can be retried in place until the server refuses the retry.
 */
export interface PaymentRecovery {
  readonly pageReopenable: boolean;
  readonly retryRefused: boolean;
}

const noRecoveryKnown: PaymentRecovery = {
  pageReopenable: false,
  retryRefused: false,
};

const step = (
  name: TicketStepName,
  state: TicketStepState,
  explained = false
): TicketStep => ({ name, state, explained });

const steps = (
  list: ReadonlyArray<TicketStep>,
  action?: TicketStepsAction
): TicketStub => ({
  _tag: "Steps",
  steps: list,
  action: Option.fromUndefinedOr(action),
});

// Payment not confirmed when the checks ran out, or by the server's word.
const paymentUnconfirmed: BookingTicketModel = {
  badge: "attention",
  reason: Option.none(),
  price: "none",
  stub: steps(
    [
      step("payment", "warning", true),
      step("confirm", "todo"),
      step("pin", "todo"),
    ],
    "check-again"
  ),
  followUp: "contact",
  dim: false,
};

const notBooked = (
  reason: TicketReason,
  price: TicketPriceNote,
  retry = false
): BookingTicketModel => ({
  badge: "not-booked",
  reason: Option.some(reason),
  price,
  stub: retry
    ? { _tag: "RetryPayment" }
    : { _tag: "BookAgain", refundNote: reason === "refund" },
  followUp: "contact",
  dim: true,
});

/**
 * A booking the customer withdrew from: cancelled, its invoice and Contact
 * us kept, never its PIN or calendar.
 */
const withdrawnTicket = (refundAmount: Money): BookingTicketModel => ({
  badge: "withdrawn",
  reason: Option.none(),
  price: "paid",
  stub: { _tag: "Withdrawn", refundAmount },
  followUp: "more-actions",
  dim: true,
});

const confirmed = (reason?: TicketReason): BookingTicketModel => ({
  badge: "confirmed",
  reason: Option.fromUndefinedOr(reason),
  price: "paid",
  stub: { _tag: "AccessPin" },
  followUp: "more-actions",
  dim: false,
});

const underWay = (
  list: ReadonlyArray<TicketStep>,
  price: TicketPriceNote,
  checking: OrderChecking,
  action?: TicketStepsAction
): BookingTicketModel => ({
  badge: "pending",
  reason: Option.none(),
  price,
  // Once the checks stop, a running step would never move on its own.
  stub: steps(list, checking === "stopped" ? "check-again" : action),
  followUp: "none",
  dim: false,
});

const delayedConfirmation: BookingTicketModel = {
  badge: "attention",
  reason: Option.none(),
  price: "paid",
  stub: steps(
    [
      step("payment", "done"),
      step("confirm", "warning", true),
      step("pin", "todo"),
    ],
    "contact"
  ),
  followUp: "none",
  dim: false,
};

const awaitingPayment: ReadonlyArray<TicketStep> = [
  step("payment", "running"),
  step("confirm", "todo"),
  step("pin", "todo"),
];

const cancelledBookingTicket = (
  payment: CustomerOrderPaymentStatus
): BookingTicketModel => ({
  badge: "cancelled",
  reason: Option.none(),
  price: "none",
  stub: { _tag: "BookAgain", refundNote: false },
  followUp: payment === "paid" ? "more-actions" : "contact",
  dim: true,
});

/**
 * The booking ticket of an order in `status`, while the screen is checking
 * it on its own or has stopped (`checking`), with what `recovery` still
 * allows. An order whose payment the checks never saw confirmed reads as
 * needing attention, as the server's delayed status does, even when its page
 * could be reopened: the server's answer may be provisional, and paying
 * twice is the risk the warning names.
 */
export const bookingTicketOf = (
  status: CustomerOrderStatus,
  checking: OrderChecking,
  recovery: PaymentRecovery = noRecoveryKnown
): BookingTicketModel => {
  const retry = !recovery.retryRefused;
  const reopen = recovery.pageReopenable ? "payment-page" : undefined;
  return {
    // Held, the payment not started or its page closed: the screen doesn't
    // check it on its own; the way back is the payment page.
    created: () => underWay(awaitingPayment, "none", "checking", reopen),
    pending: () =>
      checking === "stopped"
        ? paymentUnconfirmed
        : underWay(awaitingPayment, "none", checking, reopen),
    payment_pending_delayed: () => paymentUnconfirmed,
    paid_waiting_fulfillment: () =>
      underWay(
        [
          step("payment", "done"),
          step("confirm", "running"),
          step("pin", "todo"),
        ],
        "paid",
        checking
      ),
    paid_awaiting_delivery: () =>
      underWay(
        [
          step("payment", "done"),
          step("confirm", "done"),
          step("pin", "running"),
        ],
        "paid",
        checking
      ),
    paid_fulfillment_delayed: () => delayedConfirmation,
    fulfillment_failed: () => delayedConfirmation,
    paid_delivery_delayed: () => confirmed("email-late"),
    fulfilled: () => confirmed(),
    payment_failed: () => notBooked("payment-failed", "not-charged", retry),
    expired: () => notBooked("time-ran-out", "not-charged", retry),
    cancelled: () => notBooked("cancelled", "not-charged", retry),
    late_payment_checking: () =>
      underWay(
        [
          step("payment", "done"),
          step("manual-check", "running"),
          step("booking-or-refund", "todo"),
        ],
        "paid",
        checking
      ),
    late_payment_review: (): BookingTicketModel => ({
      badge: "attention",
      reason: Option.none(),
      price: "paid",
      stub: steps(
        [
          step("payment", "done"),
          step("manual-check", "warning", true),
          step("booking-or-refund", "todo"),
        ],
        "contact"
      ),
      followUp: "none",
      dim: false,
    }),
    late_payment_refund: () => notBooked("refund", "being-refunded"),
  }[status]();
};

/**
 * Whether a screen refreshing on `automatic` still checks the order: it
 * stopped only when it gave up before the order settled.
 */
export const orderCheckingOf = (automatic: AutomaticRefresh): OrderChecking =>
  AutomaticRefresh.$match(automatic, {
    After: (): OrderChecking => "checking",
    Stopped: ({ reason }): OrderChecking =>
      reason === "settled" ? "checking" : "stopped",
  });

/**
 * An order's ticket, with the customer's withdrawal taking precedence over
 * the resulting reservation cancellation.
 */
export const orderTicketModel = (
  order: Pick<
    CustomerOrderState,
    "status" | "paymentStatus" | "reservationCancelled" | "withdrawal"
  >,
  checking: OrderChecking,
  recovery?: PaymentRecovery
): BookingTicketModel => {
  if (order.withdrawal) return withdrawnTicket(order.withdrawal.refundAmount);
  if (order.reservationCancelled) {
    return cancelledBookingTicket(order.paymentStatus);
  }
  return bookingTicketOf(order.status, checking, recovery);
};
