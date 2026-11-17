import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { extractPdfText } from "@/shared/testing/pdf-text.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  type CorrectiveDocument,
  formatCorrectiveDocumentNumber,
  makeCorrectiveDocument,
} from "../corrective-document";
import {
  getCorrectiveDocumentPresentation,
  getCorrectiveDocumentSettlementSentence,
} from "../corrective-document-presentation";
import type { InvoiceDocument } from "../invoice";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "../invoice.test-utils";
import { invoiceIdSchema } from "../manual-invoice";
import { renderCorrectiveDocumentPdfFile } from "./corrective-document-pdf";

const correct = (
  document: InvoiceDocument,
  cause: CorrectiveDocument["cause"] = "invoice_cancellation"
) =>
  makeCorrectiveDocument({
    invoice: {
      id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb99"),
      document,
    },
    cause,
    actor: {
      source: "admin-ui",
      administrator: {
        accountId: customerAccountIdSchema.make("synthetic-administrator"),
        email: testEmailAddress("corrective-document-pdf-admin"),
      },
    },
    documentNumber: formatCorrectiveDocumentNumber({ year: 2026, sequence: 7 }),
    issuedAt: Temporal.Instant.from("2026-11-15T10:00:00Z"),
  });

const paidManual = (locale: Locale) =>
  makeTestManualInvoiceDocument(locale, "450", {
    status: "paid",
    date: plainDateStringSchema.make("2026-08-20"),
  });

const documents = supportedLocales.flatMap((locale) => [
  {
    name: `${locale} reservation, paid`,
    document: correct(
      makeCoworkInvoiceDocument(locale, { businessBuyer: true }),
      "reservation_cancellation"
    ),
    settlement: "refund_due",
  },
  {
    name: `${locale} manual, unpaid`,
    document: correct(makeTestManualInvoiceDocument(locale)),
    settlement: "nothing_due",
  },
  {
    name: `${locale} manual, paid`,
    document: correct(paidManual(locale)),
    settlement: "refund_due",
  },
]);

const render = (document: CorrectiveDocument) =>
  Effect.runPromise(renderCorrectiveDocumentPdfFile(document));

describe("corrective document PDF", () => {
  test.each(documents)(
    "renders $name from the stored document",
    async ({ document, settlement }) => {
      const file = await render(document);
      const { pageCount, text } = await extractPdfText(file.bytes);
      const presentation = getCorrectiveDocumentPresentation(document);

      expect(document.settlement).toBe(settlement);
      expect(file.fileName).toBe(`${document.documentNumber}.pdf`);
      expect(Buffer.from(file.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
      expect(pageCount).toBe(1);
      for (const shown of [
        document.documentNumber,
        document.correctedInvoice.invoiceNumber,
        presentation.total,
      ]) {
        expect(text).toContain(shown);
      }
      // The shared accounting-document font covers Latin script only; the
      // invoice PDF has the same limit for Cyrillic, Vietnamese and Devanagari.
      if (getLocaleDefinition(document.locale).script !== "latin") return;
      for (const shown of [
        presentation.title,
        presentation.reference,
        document.documentNumber,
        document.correctedInvoice.invoiceNumber,
        document.buyer.legalName,
        ...document.lines.map((line) => line.description),
        ...presentation.lines.map((line) => line.amount),
        presentation.total,
        presentation.settlement,
        ...(presentation.vatStatement === undefined
          ? []
          : [presentation.vatStatement]),
        ...presentation.factColumns.flat().map((fact) => fact.value),
      ]) {
        expect(text).toContain(shown);
      }
    }
  );

  test("prints the VAT statement only for the status the corrected invoice was issued under", async () => {
    const invoice = makeCoworkInvoiceDocument("cs-CZ");
    const textOf = async (
      vatStatus: InvoiceDocument["supplier"]["vatStatus"]
    ) =>
      (
        await extractPdfText(
          (
            await render(
              correct({
                ...invoice,
                supplier: { ...invoice.supplier, vatStatus },
              })
            )
          ).bytes
        )
      ).text;
    const statement = getCorrectiveDocumentPresentation(
      correct(invoice)
    ).vatStatement;

    expect(invoice.supplier.vatStatus).toBe("not-vat-payer");
    expect(statement).toBeDefined();
    expect(await textOf("not-vat-payer")).toContain(statement ?? "");
    expect(
      getCorrectiveDocumentPresentation(
        correct({
          ...invoice,
          supplier: { ...invoice.supplier, vatStatus: "vat-payer" },
        })
      ).vatStatement
    ).toBeUndefined();
    expect(await textOf("vat-payer")).not.toContain(statement ?? "");
  });

  test("states a different settlement for a refund and for nothing due", () => {
    const [refund, nothingDue] = [
      correct(paidManual("cs-CZ")),
      correct(makeTestManualInvoiceDocument("cs-CZ")),
    ];

    expect(refund.settlement).toBe("refund_due");
    expect(nothingDue.settlement).toBe("nothing_due");
    expect(getCorrectiveDocumentSettlementSentence(refund)).not.toBe(
      getCorrectiveDocumentSettlementSentence(nothingDue)
    );
  });

  test("prints every amount negated", () => {
    const presentation = getCorrectiveDocumentPresentation(
      correct(paidManual("en-US"))
    );

    for (const amount of [
      ...presentation.lines.map((line) => line.amount),
      presentation.total,
    ]) {
      expect(amount.startsWith("−")).toBe(true);
    }
  });

  test("names the cause in the document", () => {
    const [invoiceCause, reservationCause] = (
      ["invoice_cancellation", "reservation_cancellation"] as const
    ).map(
      (cause) =>
        getCorrectiveDocumentPresentation(
          correct(makeCoworkInvoiceDocument("cs-CZ"), cause)
        ).factColumns[1][1].value
    );

    expect(invoiceCause).not.toBe(reservationCause);
  });

  test("renders the same content on repeat renders", async () => {
    const document = correct(paidManual("cs-CZ"));
    const [first, second] = await Promise.all([
      render(document),
      render(document),
    ]);

    await expect(extractPdfText(first.bytes)).resolves.toEqual(
      await extractPdfText(second.bytes)
    );
  });
});
