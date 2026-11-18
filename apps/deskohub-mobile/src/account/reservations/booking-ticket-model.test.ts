import { describe, expect, test } from "bun:test";
import { CustomerOrderStatus } from "@deskohub/workspace-customer-api";
import { Duration, Option } from "effect";
import {
  bookingTicketOf,
  type OrderChecking,
  orderCheckingOf,
  orderTicketModel,
  type PaymentRecovery,
  type TicketStub,
} from "./booking-ticket-model";
import { AutomaticRefresh } from "./status-refresh-rules";

const statuses = CustomerOrderStatus.literals;
const checkings: ReadonlyArray<OrderChecking> = ["checking", "stopped"];

const stepsOf = (stub: TicketStub) =>
  stub._tag === "Steps"
    ? stub.steps.map(({ name, state }) => `${name}:${state}`)
    : [];
const actionOf = (stub: TicketStub) =>
  stub._tag === "Steps" ? Option.getOrUndefined(stub.action) : stub._tag;

const noRecovery: PaymentRecovery = {
  pageReopenable: false,
  retryRefused: false,
};
const reopenable: PaymentRecovery = { ...noRecovery, pageReopenable: true };
const retryRefused: PaymentRecovery = { ...noRecovery, retryRefused: true };
const awaiting = bookingTicketOf("pending", "checking");

describe("bookingTicketOf", () => {
  test("every status has a badge, and only a not-booked order dims", () => {
    for (const status of statuses) {
      for (const checking of checkings) {
        const ticket = bookingTicketOf(status, checking);
        expect(ticket.dim).toBe(ticket.badge === "not-booked");
      }
    }
  });

  test("an order without a booking names its reason and offers Book again once a retry is refused", () => {
    for (const [status, reason] of [
      ["payment_failed", "payment-failed"],
      ["expired", "time-ran-out"],
      ["cancelled", "cancelled"],
      ["late_payment_refund", "refund"],
    ] as const) {
      const ticket = bookingTicketOf(status, "checking", retryRefused);
      expect(ticket.badge).toBe("not-booked");
      expect(ticket.reason).toEqual(Option.some(reason));
      expect(ticket.stub).toEqual({
        _tag: "BookAgain",
        refundNote: status === "late_payment_refund",
      });
      expect(ticket.followUp).toBe("contact");
      expect(ticket.price).toBe(
        status === "late_payment_refund" ? "being-refunded" : "not-charged"
      );
    }
  });

  test("a confirmed order shows the PIN action and the quiet rows", () => {
    expect(bookingTicketOf("fulfilled", "checking")).toMatchObject({
      badge: "confirmed",
      reason: Option.none(),
      price: "paid",
      stub: { _tag: "AccessPin" },
      followUp: "more-actions",
    });
    // A late email is still a booking, with the reason beside the badge.
    expect(bookingTicketOf("paid_delivery_delayed", "checking")).toMatchObject({
      badge: "confirmed",
      reason: Option.some("email-late"),
      stub: { _tag: "AccessPin" },
    });
  });

  test("a payment under way shows the steps while the screen checks", () => {
    const ticket = bookingTicketOf("pending", "checking");
    expect(ticket.badge).toBe("pending");
    expect(stepsOf(ticket.stub)).toEqual([
      "payment:running",
      "confirm:todo",
      "pin:todo",
    ]);
    expect(actionOf(ticket.stub)).toBeUndefined();
  });

  test("checks that stop before the payment confirms ask to check again", () => {
    const stopped = bookingTicketOf("pending", "stopped");
    expect(stopped).toEqual(
      bookingTicketOf("payment_pending_delayed", "checking")
    );
    expect(stopped.badge).toBe("attention");
    expect(stepsOf(stopped.stub)[0]).toBe("payment:warning");
    expect(actionOf(stopped.stub)).toBe("check-again");
    expect(stopped.followUp).toBe("contact");
  });

  test("an unpaid order offers its payment page only while the server can reopen it", () => {
    for (const status of ["created", "pending"] as const) {
      const open = bookingTicketOf(status, "checking", reopenable);
      expect(open.badge).toBe("pending");
      expect(actionOf(open.stub)).toBe("payment-page");
      expect(stepsOf(open.stub)).toEqual(stepsOf(awaiting.stub));
      for (const checking of checkings) {
        expect(
          actionOf(bookingTicketOf(status, checking, noRecovery).stub)
        ).not.toBe("payment-page");
      }
    }
  });

  test("once checking stops, the warning and Check again stand even if the page could be reopened", () => {
    expect(bookingTicketOf("pending", "stopped", reopenable)).toEqual(
      bookingTicketOf("pending", "stopped", noRecovery)
    );
    expect(
      actionOf(bookingTicketOf("pending", "stopped", reopenable).stub)
    ).toBe("check-again");
  });

  test("a failed, cancelled or expired payment offers the retry until it is refused", () => {
    for (const status of ["payment_failed", "cancelled", "expired"] as const) {
      const offered = bookingTicketOf(status, "checking", noRecovery);
      expect(offered.badge).toBe("not-booked");
      expect(offered.stub).toEqual({ _tag: "RetryPayment" });
      expect(bookingTicketOf(status, "stopped", retryRefused).stub).toEqual({
        _tag: "BookAgain",
        refundNote: false,
      });
    }
    // A refund books again.
    expect(
      bookingTicketOf("late_payment_refund", "checking", noRecovery).stub._tag
    ).toBe("BookAgain");
  });

  test("confirmation under way moves through the steps", () => {
    expect(
      stepsOf(bookingTicketOf("paid_waiting_fulfillment", "checking").stub)
    ).toEqual(["payment:done", "confirm:running", "pin:todo"]);
    expect(
      stepsOf(bookingTicketOf("paid_awaiting_delivery", "checking").stub)
    ).toEqual(["payment:done", "confirm:done", "pin:running"]);
    expect(
      actionOf(bookingTicketOf("paid_waiting_fulfillment", "stopped").stub)
    ).toBe("check-again");
  });

  test("a late payment under review shows the manual check and Contact us", () => {
    const ticket = bookingTicketOf("late_payment_review", "checking");
    expect(ticket.badge).toBe("attention");
    expect(stepsOf(ticket.stub)).toEqual([
      "payment:done",
      "manual-check:warning",
      "booking-or-refund:todo",
    ]);
    expect(actionOf(ticket.stub)).toBe("contact");
  });

  test("a confirmation that failed or is late asks to contact us", () => {
    for (const status of [
      "paid_fulfillment_delayed",
      "fulfillment_failed",
    ] as const) {
      const ticket = bookingTicketOf(status, "stopped");
      expect(ticket.badge).toBe("attention");
      expect(actionOf(ticket.stub)).toBe("contact");
    }
  });
});

describe("orderCheckingOf", () => {
  test("a screen still scheduled, or stopped because the order settled, is checking", () => {
    expect(
      orderCheckingOf(AutomaticRefresh.After({ delay: Duration.seconds(3) }))
    ).toBe("checking");
    expect(
      orderCheckingOf(AutomaticRefresh.Stopped({ reason: "settled" }))
    ).toBe("checking");
  });

  test("any other stop before the order settled is stopped", () => {
    for (const reason of [
      "budget",
      "exhausted",
      "limited",
      "failed",
    ] as const) {
      expect(orderCheckingOf(AutomaticRefresh.Stopped({ reason }))).toBe(
        "stopped"
      );
    }
  });
});

describe("orderTicketModel", () => {
  const refundAmount = { value: 55_000, exponent: 2, currency: "CZK" };

  test("shows a withdrawn order as cancelled with its refund, whatever its status", () => {
    for (const status of statuses)
      for (const checking of checkings)
        expect(
          orderTicketModel({ status, withdrawal: { refundAmount } }, checking)
        ).toEqual({
          badge: "cancelled",
          reason: Option.none(),
          price: "paid",
          stub: { _tag: "Withdrawn", refundAmount },
          followUp: "more-actions",
          dim: true,
        });
  });

  test("shows any other order by its status", () => {
    for (const status of statuses)
      for (const checking of checkings)
        expect(orderTicketModel({ status }, checking, noRecovery)).toEqual(
          bookingTicketOf(status, checking, noRecovery)
        );
  });
});
