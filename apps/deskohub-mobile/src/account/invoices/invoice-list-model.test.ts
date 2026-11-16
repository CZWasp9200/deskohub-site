import { describe, expect, test } from "bun:test";
import { formatPragueDate } from "../../booking/ui/prague-date-format";
import { sampleInvoices } from "../../customer-api/testing/sample-fixtures";
import { formatInstantRange, parseInstant } from "../../i18n/date-time-format";
import {
  formatInvoiceTotal,
  type InvoiceSubject,
  invoiceListOf,
  invoiceRowOf,
  invoiceRowText,
} from "./invoice-list-model";

const locale = "en-US";
const invoices = sampleInvoices().map(({ invoice }) => invoice);
const [desk] = invoices;
if (desk === undefined) throw new Error("the sample has invoices");

// What a described invoice was for, fed by hand until the list says it (#1301).
// One whole Prague day, which reads as that day alone.
const subject: InvoiceSubject = {
  productName: "Sample desk",
  startsAt: "2026-11-25T23:00:00.000Z",
  endsAt: "2026-11-26T23:00:00.000Z",
};
const instant = (iso: string) => {
  const parsed = parseInstant(iso);
  if (parsed._tag === "None") throw new Error("a readable instant");
  return parsed.value;
};

describe("invoiceListOf", () => {
  test("no invoices is the empty state", () => {
    expect(invoiceListOf([])).toEqual({ kind: "empty" });
  });

  test("one row per invoice, in the order the Workspace lists them", () => {
    const list = invoiceListOf(invoices);

    expect(list.kind).toBe("list");
    expect(list.kind === "list" && list.rows.map((row) => row.id)).toEqual(
      invoices.map((invoice) => invoice.id)
    );
  });
});

describe("invoice rows", () => {
  test("without what it was for, a row is plain: number, issue date, total", () => {
    const row = invoiceRowOf(desk);
    const text = invoiceRowText(row, locale);

    expect(row._tag).toBe("Plain");
    expect(text).toEqual({
      title: desk.invoiceNumber,
      when: formatPragueDate(desk.issuedOn, locale, { dateStyle: "medium" }),
      amount: formatInvoiceTotal(desk.total, locale),
    });
  });

  test("described, a row leads with what it was for and the reservation's dates", () => {
    const row = invoiceRowOf(desk, subject);
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

  test("the total keeps the digits it was issued with", () => {
    expect(
      formatInvoiceTotal({ amount: "258.80", currency: "CZK" }, locale)
    ).toContain("258.80");
    expect(
      formatInvoiceTotal({ amount: "280", currency: "CZK" }, locale)
    ).not.toContain(".");
  });
});
