import { describe, expect, test } from "bun:test";
import {
  type CustomerOrderState,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import { monitorOptionName } from "../../booking/ui/price-line-description";
import { m } from "../../i18n/messages";
import { bookingTicketOf, orderTicketModel } from "./booking-ticket-model";
import { bookingTimeLine } from "./booking-ticket-text";
import { dateTileParts } from "./booking-time";
import { orderTicketView } from "./order-ticket-view";
import type { ReservationListRow } from "./reservation-list-model";

const locale = "en-US";

const reservedDesk = (monitorOption?: "2x27-qhd"): CustomerOrderState => ({
  orderId: CustomerReservationOrderId.make("order-workstation"),
  kind: "cowork",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
  startsAt: "2026-11-26T08:00:00.000Z",
  endsAt: "2026-11-27T08:00:00.000Z",
  total: { value: 53000, exponent: 2, currency: "CZK" },
  bookedSelection: {
    selection: {
      family: "cowork",
      date: "2026-11-26",
      tier: "reserved-desk",
      ...(monitorOption && { monitorOption }),
    },
  },
});

const metaOf = (order: CustomerOrderState) =>
  orderTicketView({
    order,
    model: bookingTicketOf("fulfilled", "checking"),
    reservation: Option.none(),
    establishment: Option.none(),
    now: DateTime.makeUnsafe("2026-11-20T08:00:00.000Z"),
    locale,
  }).meta;

const failedOrderId = CustomerReservationOrderId.make("order-failed");
const startsAt = "2026-11-14T09:00:00Z";
const endsAt = "2026-11-14T11:00:00Z";

// The order status carries no times once the payment ended unpaid.
const failedOrder: CustomerOrderState = {
  orderId: failedOrderId,
  kind: "meeting-room",
  status: "payment_failed",
  paymentStatus: "failed",
  fulfillmentStatus: "not_started",
};

const listed: ReservationListRow = {
  id: "reservation-failed",
  orderId: failedOrderId,
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
    now: DateTime.makeUnsafe("2026-11-08T12:00:00Z"),
    locale,
  });

describe("orderTicketView", () => {
  test("lists the workstation once, with its monitor setup under it", () => {
    const workstation = metaOf(reservedDesk("2x27-qhd")).filter(
      (line) => line.key === "monitor"
    );
    expect(workstation.map(({ text, detail }) => ({ text, detail }))).toEqual([
      {
        text: m.booking_checkout_line_workstation({}, { locale }),
        detail: monitorOptionName("2x27-qhd"),
      },
    ]);
  });

  test("lists no workstation for a desk without one", () => {
    expect(metaOf(reservedDesk()).some((line) => line.key === "monitor")).toBe(
      false
    );
  });

  test("a failed order keeps the booked time its list entry holds", () => {
    const view = viewOf(failedOrder, Option.some(listed));

    const start = DateTime.makeUnsafe(startsAt);
    expect(view.date).toEqual(dateTileParts(start, locale));
    expect(view.lines).toEqual([
      bookingTimeLine(start, DateTime.makeUnsafe(endsAt), locale),
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
      dateTileParts(DateTime.makeUnsafe("2026-11-15T09:00:00Z"), locale)
    );
  });

  test("without times anywhere the time reads as unavailable", () => {
    const view = viewOf(failedOrder, Option.none());

    expect(view.date).toBeUndefined();
    expect(view.lines).toEqual([
      m.reservations_value_unavailable({}, { locale }),
    ]);
  });
});

const orderId = CustomerReservationOrderId.make("order-withdrawal");
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
const withdrawalViewOf = (shown: CustomerOrderState) =>
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
    const live = withdrawalViewOf(order);
    const withdrawn = withdrawalViewOf({
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
    const live = withdrawalViewOf(order);
    const withdrawn = withdrawalViewOf({
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
