import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { serializeCsv } from "@/shared/utils/csv";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { correctiveDocumentNumberSchema } from "./corrective-document";
import {
  type CustomerInvoiceStatus,
  type CustomerInvoiceSummary,
  getCustomerInvoiceCsvColumns,
  getCustomerInvoiceStatus,
  getCustomerInvoiceStatusLabel,
  getCustomerInvoiceSummary,
} from "./customer-invoice";
import type { InvoiceDocument } from "./invoice";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "./invoice.test-utils";
import type { InvoiceCancellationFact } from "./invoice-cancellation";
import { getInvoiceTotal } from "./invoice-settlement";
import { invoiceIdSchema } from "./manual-invoice";

const date = plainDateStringSchema.make;
const invoiceId = invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb31");
const issuedAt = Temporal.Instant.from("2026-08-20T10:00:00Z");

const summarize = (
  document: InvoiceDocument,
  today = date("2026-08-25"),
  cancellation: InvoiceCancellationFact | null = null
) =>
  getCustomerInvoiceSummary(
    { id: invoiceId, issuedAt, document, cancellation },
    today
  );

const correctiveDocumentNumber =
  correctiveDocumentNumberSchema.make("WS-OD-2026-000003");
const cancellation: InvoiceCancellationFact = {
  cancelledAt: Temporal.Instant.from("2026-08-28T10:00:00Z"),
  cause: "reservation_cancellation",
  correctiveDocumentNumber,
};

const dueManual = makeTestManualInvoiceDocument("en-US", "450.50", {
  status: "due",
  date: date("2026-09-01"),
});

describe("customer invoice summary", () => {
  test("reads a reservation invoice as paid at its quoted total", () => {
    const document = makeCoworkInvoiceDocument("en-US");

    expect(summarize(document)).toEqual({
      id: invoiceId,
      invoiceNumber: document.invoiceNumber,
      issuedOn: date("2026-08-20"),
      total: getInvoiceTotal(document),
      paymentStatus: "paid",
      dueDate: null,
      cancellation: null,
    });
  });

  test("marks a cancelled invoice cancelled in place of its payment status, with its corrective document", () => {
    const summary = summarize(dueManual, date("2026-09-02"), cancellation);

    expect(summary.cancellation).toEqual({ correctiveDocumentNumber });
    expect(summary.paymentStatus).toBe("overdue");
    expect(summary.dueDate).toBeNull();
    expect(summarize(dueManual, date("2026-09-02")).dueDate).toBe(
      date("2026-09-01")
    );
    expect(getCustomerInvoiceStatus(summary)).toBe("cancelled");
    expect(getCustomerInvoiceStatus(summarize(dueManual))).toBe("issued");
  });

  test("keeps the exact total of a manual invoice", () => {
    expect(summarize(dueManual).total).toEqual({
      amount: dueManual.total,
      currency: dueManual.currency,
    });
  });

  test.each([
    ["2026-08-31", "issued"],
    ["2026-09-01", "due"],
    ["2026-09-02", "overdue"],
  ] as const)(
    "on %s a requested payment reads as %s with its due date",
    (today, paymentStatus) => {
      expect(summarize(dueManual, date(today))).toMatchObject({
        paymentStatus,
        dueDate: date("2026-09-01"),
      });
    }
  );

  test("states no due date once nothing is requested", () => {
    const paid = makeTestManualInvoiceDocument("en-US", "450", {
      status: "paid",
      date: date("2026-08-20"),
    });
    const nothingDue = makeTestManualInvoiceDocument("en-US", "0", {
      status: "due",
      date: date("2026-08-01"),
    });

    expect(summarize(paid)).toMatchObject({
      paymentStatus: "paid",
      dueDate: null,
    });
    expect(summarize(nothingDue)).toMatchObject({
      paymentStatus: "issued",
      dueDate: null,
    });
  });

  test("dates the issue on the Prague calendar day", () => {
    const summary = getCustomerInvoiceSummary(
      {
        id: invoiceId,
        issuedAt: Temporal.Instant.from("2026-08-31T22:30:00Z"),
        document: dueManual,
      },
      date("2026-09-01")
    );

    expect(summary.issuedOn).toBe(date("2026-09-01"));
  });
});

describe("customer invoice status label", () => {
  const statuses: readonly CustomerInvoiceStatus[] = [
    "paid",
    "issued",
    "due",
    "overdue",
    "cancelled",
  ];

  test.each(["en-US", "cs-CZ"] as const)(
    "names every status apart in %s",
    (locale) => {
      const labels = statuses.map((status) =>
        getCustomerInvoiceStatusLabel(status, locale)
      );

      expect(labels.every((label) => label.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(statuses.length);
    }
  );
});

describe("customer invoice CSV", () => {
  const summaries: readonly CustomerInvoiceSummary[] = [
    summarize(dueManual, date("2026-09-02")),
    summarize(makeCoworkInvoiceDocument("en-US")),
    summarize(makeCoworkInvoiceDocument("en-US"), undefined, cancellation),
  ];
  const records = (locale: "en-US" | "cs-CZ") =>
    serializeCsv(getCustomerInvoiceCsvColumns(locale), summaries)
      .split("\r\n")
      .filter((record) => record.length > 0)
      .map((record) => record.split(","));

  test("writes a header and one record per invoice", () => {
    const [header, ...rows] = records("en-US");

    expect(header).toHaveLength(7);
    expect(header!.every((cell) => cell.length > 0)).toBe(true);
    expect(rows).toEqual(
      summaries.map((summary) => [
        summary.invoiceNumber,
        summary.issuedOn,
        summary.dueDate ?? "",
        summary.total.amount,
        summary.total.currency,
        getCustomerInvoiceStatusLabel(
          getCustomerInvoiceStatus(summary),
          "en-US"
        ),
        summary.cancellation?.correctiveDocumentNumber ?? "",
      ])
    );
  });

  test("localizes the header and statuses but not the data", () => {
    const english = records("en-US");
    const czech = records("cs-CZ");

    expect(czech[0]).not.toEqual(english[0]);
    expect(czech[1]!.at(-2)).toBe(
      getCustomerInvoiceStatusLabel("overdue", "cs-CZ")
    );
    expect(czech[3]!.slice(-2)).toEqual([
      getCustomerInvoiceStatusLabel("cancelled", "cs-CZ"),
      correctiveDocumentNumber,
    ]);
    const withoutStatus = (rows: string[][]) =>
      rows.slice(1).map((row) => row.toSpliced(-2, 1));
    expect(withoutStatus(czech)).toEqual(withoutStatus(english));
  });
});
