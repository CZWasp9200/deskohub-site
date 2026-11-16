import { describe, expect, test } from "bun:test";
import { CustomerOrderStatus } from "@deskohub/workspace-customer-api";
import { Duration, Option } from "effect";
import {
  bookingTicketOf,
  type OrderChecking,
  orderCheckingOf,
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

describe("bookingTicketOf", () => {
  test("every status has a badge, and only a not-booked order dims", () => {
    for (const status of statuses) {
      for (const checking of checkings) {
        const ticket = bookingTicketOf(status, checking);
        expect(ticket.dim).toBe(ticket.badge === "not-booked");
      }
    }
  });

  test("an order without a booking names its reason and offers Book again", () => {
    for (const [status, reason] of [
      ["payment_failed", "payment-failed"],
      ["expired", "time-ran-out"],
      ["cancelled", "cancelled"],
      ["late_payment_refund", "refund"],
    ] as const) {
      const ticket = bookingTicketOf(status, "checking");
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

  test("a held order keeps the payment page as its action", () => {
    for (const checking of checkings) {
      expect(actionOf(bookingTicketOf("created", checking).stub)).toBe(
        "payment-page"
      );
    }
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
