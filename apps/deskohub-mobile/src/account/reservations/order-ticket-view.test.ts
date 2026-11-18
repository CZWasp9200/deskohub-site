import { describe, expect, test } from "bun:test";
import type {
  CustomerOrderState,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import { orderTicketModel } from "./booking-ticket-model";
import { orderTicketView } from "./order-ticket-view";
import type { ReservationListRow } from "./reservation-list-model";

const orderId = "order-1" as CustomerReservationOrderId;
const total = { value: 55_000, exponent: 2, currency: "CZK" };
// A paid booking that starts in two hours, its PIN working from its start.
const order: CustomerOrderState = {
  orderId,
  kind: "meeting-room",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
  startsAt: "2026-11-20T10:00:00Z",
  endsAt: "2026-11-20T12:00:00Z",
  total,
};
const reservation = Option.some<ReservationListRow>({
  id: "reservation-1",
  orderId,
  product: { kind: "meeting-room" },
  startsAt: order.startsAt ?? null,
  endsAt: order.endsAt ?? null,
  seats: 2,
  status: "confirmed",
  accessStartsAt: "2026-11-20T09:45:00Z",
});
const viewOf = (shown: CustomerOrderState) =>
  orderTicketView({
    order: shown,
    model: orderTicketModel(shown, "checking"),
    reservation,
    establishment: Option.none(),
    now: DateTime.makeUnsafe("2026-11-20T08:00:00Z"),
    locale: "en-US",
  });

describe("orderTicketView of a withdrawn order", () => {
  test("drops the countdown, the PIN hint and the calendar event", () => {
    const live = viewOf(order);
    const withdrawn = viewOf({
      ...order,
      withdrawal: { submittedAt: "2026-11-19T08:00:00Z", refundAmount: total },
    });

    // The same booking before the withdrawal has all three.
    expect(live.lead).toBeDefined();
    expect(live.accessHint).toBeDefined();
    expect(live.event).toBeDefined();
    expect(withdrawn.lead).toBeUndefined();
    expect(withdrawn.accessHint).toBeUndefined();
    expect(withdrawn.event).toBeUndefined();
  });

  test("keeps what the booking was: its date, title, time and price", () => {
    const live = viewOf(order);
    const withdrawn = viewOf({
      ...order,
      withdrawal: { submittedAt: "2026-11-19T08:00:00Z", refundAmount: total },
    });

    expect(withdrawn.date).toEqual(live.date);
    expect(withdrawn.title).toBe(live.title);
    expect(withdrawn.lines).toEqual(live.lines);
    expect(withdrawn.meta.map(({ key }) => key)).toEqual(
      live.meta.map(({ key }) => key)
    );
  });
});
