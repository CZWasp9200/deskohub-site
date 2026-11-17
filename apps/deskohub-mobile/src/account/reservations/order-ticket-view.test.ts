import { describe, expect, test } from "bun:test";
import type { CustomerOrderState } from "@deskohub/workspace-customer-api";
import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import { monitorOptionName } from "../../booking/ui/price-line-description";
import { m } from "../../i18n/messages";
import { bookingTicketOf } from "./booking-ticket-model";
import { orderTicketView } from "./order-ticket-view";

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
});
