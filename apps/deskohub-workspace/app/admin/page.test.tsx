import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));

let customerOverviewLoads = 0;
let reservationOverviewLoads = 0;
let refundAttentionLoads = 0;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationOverview: () => {
    customerOverviewLoads += 1;
    return new Promise(() => {});
  },
  loadAdministrationReservationOverview: () => {
    reservationOverviewLoads += 1;
    return new Promise(() => {});
  },
  loadAdministrationRefundAttention: () => {
    refundAttentionLoads += 1;
    return new Promise(() => {});
  },
}));

mock.module("@/features/administration/reservation-lookup", () => ({
  ReservationLookup: () => null,
}));

mock.module("@/features/discounts/admin/customer-admin-client", () => ({
  CustomerSearch: () => null,
}));

describe("AdminPage", () => {
  test("starts reservation and customer activity independently", async () => {
    const { default: AdminPage } = await import("./page");

    AdminPage();

    expect(reservationOverviewLoads).toBe(1);
    expect(customerOverviewLoads).toBe(1);
    expect(refundAttentionLoads).toBe(1);
  });
});
