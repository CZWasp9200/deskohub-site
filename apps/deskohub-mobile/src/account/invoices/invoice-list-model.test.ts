import { describe, expect, test } from "bun:test";
import type { CustomerInvoice } from "@deskohub/workspace-customer-api";
import { formatPragueDate } from "../../booking/ui/prague-date-format";
import { sampleInvoices } from "../../customer-api/testing/sample-fixtures";
import { formatInstantRange, parseInstant } from "../../i18n/date-time-format";
import {
  downloadableCreditNoteNumber,
  formatInvoiceTotal,
  invoiceListOf,
  invoiceRowOf,
  invoiceRowText,
} from "./invoice-list-model";

const locale = "en-US";
const invoices = sampleInvoices().map(({ invoice }) => invoice);
// The desk invoice says what it was for; the office one, issued by hand,
// doesn't.
const desk = invoices.find((invoice) => invoice.reservation !== undefined);
const manual = invoices.find((invoice) => invoice.reservation === undefined);
if (desk?.reservation === undefined || manual === undefined)
  throw new Error("the sample has described and plain invoices");
const subject = desk.reservation;
const instant = (iso: string) => {
  const parsed = parseInstant(iso);
  if (parsed._tag === "None") throw new Error("a readable instant");
  return parsed.value;
};

describe("invoiceListOf", () => {
  test("no invoices is the empty state", () => {
    expect(invoiceListOf([])).toEqual({ kind: "empty" });
  });

  test("one row per invoice, in the order the Workspace lists them, described when it says what for", () => {
    const list = invoiceListOf(invoices);

    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.rows.map((row) => row.id)).toEqual(
      invoices.map((invoice) => invoice.id)
    );
    expect(list.rows.map((row) => row._tag)).toEqual(
      invoices.map((invoice) =>
        invoice.reservation === undefined ? "Plain" : "Described"
      )
    );
  });
});

describe("invoice rows", () => {
  test("without what it was for, a row is plain: number, issue date, total", () => {
    const row = invoiceRowOf(manual);
    const text = invoiceRowText(row, locale);

    expect(row._tag).toBe("Plain");
    expect(text).toEqual({
      title: manual.invoiceNumber,
      when: formatPragueDate(manual.issuedOn, locale, { dateStyle: "medium" }),
      amount: formatInvoiceTotal(manual.total, locale),
    });
  });

  test("described, a row leads with what it was for and the reservation's dates", () => {
    const row = invoiceRowOf(desk);
    const text = invoiceRowText(row, locale);

    expect(row._tag).toBe("Described");
    expect(text.title).toBe(subject.productName);
    expect(text.when).toBe(
      formatInstantRange(
        instant(subject.startsAt),
        instant(subject.endsAt),
        locale
      ).start
    );
    expect(text.amount).toContain(formatInvoiceTotal(desk.total, locale));
    expect(text.amount).toContain(desk.invoiceNumber);
  });

  test("an office's row names its seats after the product", () => {
    const office: CustomerInvoice = {
      ...desk,
      reservation: { ...subject, productName: "Sample office", seats: 6 },
    };

    const { title } = invoiceRowText(invoiceRowOf(office), locale);

    expect(title).not.toBe("Sample office");
    expect(title).toContain("Sample office");
    expect(title).toContain("6");
  });

  test("the total keeps the digits it was issued with", () => {
    expect(
      formatInvoiceTotal({ amount: "258.80", currency: "CZK" }, locale)
    ).toContain("258.80");
    expect(
      formatInvoiceTotal({ amount: "280", currency: "CZK" }, locale)
    ).not.toContain(".");
  });
});

describe("downloadableCreditNoteNumber", () => {
  const cancellation = { correctiveDocumentNumber: "WS-OD-2026-000004" };

  test("a cancelled row carries its cancellation and offers the credit note the Workspace serves", () => {
    for (const invoice of [desk, manual]) {
      const row = invoiceRowOf({
        ...invoice,
        cancellation: { ...cancellation, correctiveDocumentDownloadable: true },
      });

      expect(row.cancellation?.correctiveDocumentNumber).toBe(
        cancellation.correctiveDocumentNumber
      );
      expect(downloadableCreditNoteNumber(row)).toBe(
        cancellation.correctiveDocumentNumber
      );
    }
  });

  test("a Workspace that doesn't serve the credit note leaves the cancelled row without it", () => {
    const row = invoiceRowOf({ ...desk, cancellation });

    expect(row.cancellation).toEqual(cancellation);
    expect(downloadableCreditNoteNumber(row)).toBeUndefined();
  });

  test("an invoice in force has no cancellation and no credit note", () => {
    const row = invoiceRowOf(desk);

    expect(row.cancellation).toBeUndefined();
    expect(downloadableCreditNoteNumber(row)).toBeUndefined();
  });
});
