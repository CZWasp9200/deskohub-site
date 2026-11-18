// DESIGN PREVIEW ONLY: synthetic withdrawal quotes, labelled the way
// getReservationContractLabel labels them (product · when).
import "@/shared/polyfills/temporal";
import { getReservationProductName } from "@/features/account/reservation-product-name";
import type { Locale } from "@/features/i18n";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
} from "@/features/reservation/reservation-date";
import type { WithdrawalQuoteData } from "@/features/withdrawal/withdrawal-read-model";

const czk = (value: number) =>
  ({ value: value * 100, exponent: 2, currency: "CZK" }) as never;

/**
 * `full`: a Profi day not started yet. `partial`: a four-day office with three
 * days started. `fallback`: `full` for an account without a name.
 */
export const withdrawalQuoteStub = (
  state: string,
  locale: Locale
): WithdrawalQuoteData =>
  state === "partial"
    ? {
        contractId: "workspace_01JY4K2T9B7C3D5E6F8G9H0J1K",
        contractLabel: `${getReservationProductName({ kind: "office" }, locale)} · ${formatReservationDisplayDateRange(
          Temporal.Instant.from("2026-11-15T23:00:00Z"),
          Temporal.Instant.from("2026-11-19T23:00:00Z"),
          locale
        )}`,
        customerName: "Jana Nováková",
        receiptEmail: "jana.novakova@deskohub.test",
        paidAmount: czk(4800),
        refundAmount: czk(1200),
        refundBasis: { kind: "partial", unit: "day", unstarted: 1, total: 4 },
        periodEndsAt: "2026-11-24T23:00:00Z",
      }
    : {
        contractId: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
        contractLabel: `${getReservationProductName({ kind: "cowork", tier: "profi" } as never, locale)} · ${formatReservationDisplayDate(
          Temporal.Instant.from("2026-12-06T23:00:00Z"),
          locale
        )}`,
        customerName: state === "fallback" ? null : "Jana Nováková",
        receiptEmail: "jana.novakova@deskohub.test",
        paidAmount: czk(550),
        refundAmount: czk(550),
        refundBasis: { kind: "full" },
        periodEndsAt: "2026-12-01T23:00:00Z",
      };
