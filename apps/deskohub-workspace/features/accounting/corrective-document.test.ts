import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { BigDecimal, Effect } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  decodeCorrectiveDocument,
  formatCorrectiveDocumentNumber,
  makeCorrectiveDocument,
} from "./corrective-document";
import type { InvoiceDocument } from "./invoice";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "./invoice.test-utils";
import { getInvoiceStatedLines } from "./invoice-presentation";
import { getInvoiceTotal } from "./invoice-settlement";
import { invoiceIdSchema } from "./manual-invoice";

const invoiceId = invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb99");
const issuedAt = Temporal.Instant.from("2026-11-15T10:00:00Z");
const actor = {
  source: "admin-ui" as const,
  administrator: {
    accountId: customerAccountIdSchema.make("synthetic-administrator"),
    email: testEmailAddress("corrective-document-admin"),
  },
};

const cancel = (document: InvoiceDocument) =>
  makeCorrectiveDocument({
    invoice: { id: invoiceId, document },
    cause: "invoice_cancellation",
    actor,
    documentNumber: formatCorrectiveDocumentNumber({ year: 2026, sequence: 7 }),
    issuedAt,
  });

const sum = (amounts: readonly string[]) =>
  BigDecimal.sumAll(
    amounts.map((amount) => BigDecimal.fromStringUnsafe(amount))
  );

const issuedInvoices = [
  ["cowork", makeCoworkInvoiceDocument("cs-CZ")],
  ["meeting room", makeMeetingRoomInvoiceDocument("en-US")],
  ["office", makeOfficeInvoiceDocument("de-DE")],
  ["manual", makeTestManualInvoiceDocument("cs-CZ")],
] as const;

describe("corrective document number", () => {
  test("numbers its own annual series", () => {
    expect(formatCorrectiveDocumentNumber({ year: 2026, sequence: 1 })).toBe(
      "WS-OD-2026-000001"
    );
    expect(
      formatCorrectiveDocumentNumber({ year: 2027, sequence: 1_234_567 })
    ).toBe("WS-OD-2027-1234567");
  });

  test("refuses components outside their range", () => {
    expect(() =>
      formatCorrectiveDocumentNumber({ year: 2026, sequence: 0 })
    ).toThrow(RangeError);
    expect(() =>
      formatCorrectiveDocumentNumber({ year: 2026.5, sequence: 1 })
    ).toThrow(RangeError);
  });
});

describe("makeCorrectiveDocument", () => {
  test.each(issuedInvoices)(
    "negates every line and the total of a %s invoice",
    (_kind, document) => {
      const corrective = cancel(document);
      const stated = getInvoiceStatedLines(document);

      expect(corrective.lines).toEqual(
        stated.map((line) => ({
          description: line.description,
          amount: BigDecimal.format(
            BigDecimal.negate(BigDecimal.fromStringUnsafe(line.amount))
          ),
        }))
      );
      const total = getInvoiceTotal(document);
      expect(
        BigDecimal.equals(
          BigDecimal.fromStringUnsafe(corrective.total),
          BigDecimal.negate(BigDecimal.fromStringUnsafe(total.amount))
        )
      ).toBe(true);
      expect(corrective.currency).toBe(total.currency);
      // The invoice's lines add up to its total, so the negated lines add up
      // to the negated total.
      expect(
        BigDecimal.equals(
          sum(corrective.lines.map(({ amount }) => amount)),
          BigDecimal.fromStringUnsafe(corrective.total)
        )
      ).toBe(true);
    }
  );

  test.each(issuedInvoices)(
    "copies the parties and references the cancelled %s invoice",
    (_kind, document) => {
      const corrective = cancel(document);

      expect(corrective).toMatchObject({
        documentKind: "invoice-cancellation",
        documentNumber: "WS-OD-2026-000007",
        issuedAt: "2026-11-15T10:00:00.000Z",
        locale: document.locale,
        dotyposCustomerId: document.dotyposCustomerId,
        cause: "invoice_cancellation",
        correctedInvoice: {
          invoiceId,
          invoiceNumber: document.invoiceNumber,
          issuedAt: document.issuedAt,
        },
        supplier: document.supplier,
        buyer: document.buyer,
        provenance: {
          source: "admin-ui",
          actor: actor.administrator.email,
          system: "deskohub-workspace",
          generatedAt: "2026-11-15T10:00:00.000Z",
        },
      });
    }
  );

  test.each(issuedInvoices)(
    "builds a %s corrective document its strict schema accepts",
    async (_kind, document) => {
      const corrective = cancel(document);

      expect(
        await Effect.runPromise(
          decodeCorrectiveDocument(JSON.parse(JSON.stringify(corrective)))
        )
      ).toEqual(corrective);
    }
  );

  test("owes a refund for a paid invoice and nothing for an unpaid one", () => {
    expect(cancel(makeCoworkInvoiceDocument("cs-CZ")).settlement).toBe(
      "refund_due"
    );
    expect(
      cancel(
        makeTestManualInvoiceDocument("cs-CZ", "450", {
          status: "paid",
          date: plainDateStringSchema.make("2026-08-20"),
        })
      ).settlement
    ).toBe("refund_due");
    expect(cancel(makeTestManualInvoiceDocument("cs-CZ")).settlement).toBe(
      "nothing_due"
    );
    expect(
      cancel(
        makeTestManualInvoiceDocument("cs-CZ", "0", {
          status: "paid",
          date: plainDateStringSchema.make("2026-08-20"),
        })
      ).settlement
    ).toBe("nothing_due");
  });

  test("turns a negative manual line into a positive corrective line", () => {
    const corrective = cancel(
      makeTestManualInvoiceDocument("en-US", "-120.50")
    );

    expect(corrective.lines.map(({ amount }) => amount)).toEqual(["120.5"]);
    expect(corrective.total).toBe("120.5");
  });
});
