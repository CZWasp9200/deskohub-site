import { describe, expect, test } from "bun:test";
import {
  type CustomerOrderState,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import { m } from "../../i18n/messages";
import { bookingTicketOf } from "./booking-ticket-model";
import { bookingTimeLine } from "./booking-ticket-text";
import { dateTileParts } from "./booking-time";
import { orderTicketView } from "./order-ticket-view";
import type { ReservationListRow } from "./reservation-list-model";

const now = DateTime.makeUnsafe("2026-11-08T12:00:00Z");
const orderId = CustomerReservationOrderId.make("order-failed");
const startsAt = "2026-11-14T09:00:00Z";
const endsAt = "2026-11-14T11:00:00Z";

// The order status carries no times once the payment ended unpaid.
const failedOrder: CustomerOrderState = {
  orderId,
  kind: "meeting-room",
  status: "payment_failed",
  paymentStatus: "failed",
  fulfillmentStatus: "not_started",
};

const listed: ReservationListRow = {
  id: "reservation-failed",
  orderId,
  product: { kind: "meeting-room" },
  startsAt,
  endsAt,
  seats: 4,
  status: "cancelled",
};

const viewOf = (
  order: CustomerOrderState,
  reservation: Option.Option<ReservationListRow>
) =>
  orderTicketView({
    order,
    model: bookingTicketOf(order.status, "checking"),
    reservation,
    establishment: Option.none(),
    now,
    locale: "en-US",
  });

describe("orderTicketView", () => {
  test("a failed order keeps the booked time its list entry holds", () => {
    const view = viewOf(failedOrder, Option.some(listed));

    const start = DateTime.makeUnsafe(startsAt);
    expect(view.date).toEqual(dateTileParts(start, "en-US"));
    expect(view.lines).toEqual([
      bookingTimeLine(start, DateTime.makeUnsafe(endsAt), "en-US"),
    ]);
  });

  test("the order's own times win over its list entry's", () => {
    const view = viewOf(
      {
        ...failedOrder,
        startsAt: "2026-11-15T09:00:00Z",
        endsAt: "2026-11-15T10:00:00Z",
      },
      Option.some(listed)
    );

    expect(view.date).toEqual(
      dateTileParts(DateTime.makeUnsafe("2026-11-15T09:00:00Z"), "en-US")
    );
  });

  test("without times anywhere the time reads as unavailable", () => {
    const view = viewOf(failedOrder, Option.none());

    expect(view.date).toBeUndefined();
    expect(view.lines).toEqual([
      m.reservations_value_unavailable({}, { locale: "en-US" }),
    ]);
  });
});
