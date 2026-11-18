import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { formatCorrectiveDocumentNumber } from "./corrective-document";
import {
  adminUiInvoiceVisibility,
  customerInvoiceVisibility,
  type InvoiceStanding,
} from "./invoice-visibility";

const cancellation = {
  cancelledAt: Temporal.Instant.from("2026-11-15T10:00:00Z"),
  cause: "invoice_cancellation" as const,
  correctiveDocumentNumber: formatCorrectiveDocumentNumber({
    year: 2026,
    sequence: 1,
  }),
};
const archivedAt = Temporal.Instant.from("2026-11-16T10:00:00Z");

const live: InvoiceStanding = { cancellation: null, archivedAt: null };
const cancelled: InvoiceStanding = { cancellation, archivedAt: null };
const archived: InvoiceStanding = { cancellation, archivedAt };

describe("invoice visibility", () => {
  test("the administration UI lists live and cancelled invoices and hides archived ones", () => {
    expect(adminUiInvoiceVisibility(live)).toBe("listed");
    expect(adminUiInvoiceVisibility(cancelled)).toBe("listed_cancelled");
    expect(adminUiInvoiceVisibility(archived)).toBe("hidden");
  });

  test("the customer keeps cancelled and archived invoices, marked cancelled", () => {
    expect(customerInvoiceVisibility(live)).toBe("listed");
    expect(customerInvoiceVisibility(cancelled)).toBe("listed_cancelled");
    expect(customerInvoiceVisibility(archived)).toBe("listed_cancelled");
  });
});
