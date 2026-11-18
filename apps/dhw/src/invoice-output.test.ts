import { describe, expect, test } from "bun:test";
import type { AdministrationReservationDetailType } from "@deskohub/workspace-admin-api";
import {
  planInvoiceCancellation,
  planReservationInvoiceConsequences,
} from "./invoice-output";

const reservation = {
  reservation: {
    id: "01980000-0000-7000-8000-0000000000d2",
    date: "2026-11-20",
    startsAt: null,
    typeLabel: "Meeting room",
    customer: null,
    customerId: "customer-d1",
    status: { label: "Confirmed" },
  },
} as unknown as AdministrationReservationDetailType;

describe("planInvoiceCancellation", () => {
  const plans = (["owed", "not_owed"] as const).flatMap((customerNotice) =>
    (
      [
        "none",
        "cancels_reservation",
        "already_cancelled",
        "cancellation_in_progress",
      ] as const
    ).map((reservationPlan) => ({
      customerNotice,
      reservation: reservationPlan,
    }))
  );

  test("confirms exactly the consequences its prompt shows", () => {
    for (const plan of plans) {
      for (const flags of [
        { sendCancellationEmail: false },
        { sendCancellationEmail: true },
      ]) {
        const planned = planInvoiceCancellation({
          invoiceNumber: "WS-FV-2026-000009",
          plan,
          reservation:
            plan.reservation === "cancels_reservation" ? reservation : null,
          flags,
        });
        const showsReservation = planned.consequences.includes(
          "reservation_cancellation"
        );

        expect(planned.input.confirmedCustomerNotice).toBe(
          planned.consequences.includes("customer_notice")
        );
        expect(planned.consequences.includes("customer_notice")).toBe(
          plan.customerNotice === "owed"
        );
        expect(showsReservation).toBe(
          plan.reservation === "cancels_reservation"
        );
        expect(planned.prompt.includes(reservation.reservation.id)).toBe(
          showsReservation
        );
        expect(planned.input.reservation).toEqual(
          showsReservation ? flags : undefined
        );
      }
    }
  });
});

describe("planReservationInvoiceConsequences", () => {
  test("confirms a live invoice and its notice, and nothing without one", () => {
    const invoice = (
      state: "live" | "cancelled",
      customerNotice: "owed" | "not_owed"
    ) => ({
      id: "01980000-0000-7000-8000-0000000000d1" as never,
      invoiceNumber: "WS-FV-2026-000001",
      state,
      archived: false,
      customerNotice,
    });

    const planned = [
      invoice("live", "owed"),
      invoice("live", "not_owed"),
      invoice("cancelled", "owed"),
      null,
    ].map(planReservationInvoiceConsequences);

    expect(
      planned.map(({ confirmedConsequences }) => confirmedConsequences)
    ).toEqual([
      { invoice: true, customerNotice: true },
      { invoice: true, customerNotice: false },
      { invoice: false, customerNotice: false },
      { invoice: false, customerNotice: false },
    ]);
    expect(planned.map(({ lines }) => lines.length)).toEqual([2, 1, 0, 0]);
  });
});
