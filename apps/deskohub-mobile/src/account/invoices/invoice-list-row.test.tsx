import { describe, expect, test } from "bun:test";
import type { CustomerInvoice } from "@deskohub/workspace-customer-api";
import { sampleInvoices } from "../../customer-api/testing/sample-fixtures";
import { Badge } from "../../ui/badge";
import { ListRow } from "../../ui/list";
import { invoiceRowOf } from "./invoice-list-model";
import { InvoiceListRow } from "./invoice-list-row";

const invoices = sampleInvoices().map(({ invoice }) => invoice);
const cancelled = (invoice: CustomerInvoice): CustomerInvoice => ({
  ...invoice,
  cancellation: { correctiveDocumentNumber: "SAMPLE-CN-1" },
});

const element = (invoice: CustomerInvoice) =>
  InvoiceListRow({
    row: invoiceRowOf(invoice),
    locale: "en-US",
    downloading: false,
    held: false,
    onDownload: () => undefined,
  });

// A cancelled invoice stays listed and downloadable, marked cancelled; an
// invoice still in force carries no mark.
describe("InvoiceListRow", () => {
  test("marks a cancelled invoice cancelled and reads the mark, described or plain", () => {
    for (const invoice of invoices) {
      const row = element(cancelled(invoice));

      expect(row.type).toBe(ListRow);
      expect(row.props.badge.type).toBe(Badge);
      expect(row.props.badge.props.tone).toBe("neutral");
      expect(row.props.accessibilityLabel).toContain(
        row.props.badge.props.label
      );
      expect(row.props.onPress).toBeFunction();
    }
  });

  test("an invoice in force has no cancelled mark", () => {
    for (const invoice of invoices) {
      const row = element(invoice);

      expect(invoice.cancellation).toBeUndefined();
      expect(row.type).toBe(ListRow);
      expect(row.props.badge).toBeUndefined();
    }
  });
});
