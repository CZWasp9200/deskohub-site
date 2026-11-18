import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { invoicePreviewIdSchema } from "@/features/accounting/admin/invoice-preview-id";
import { InvoicePreviews } from "@/features/accounting/admin/invoice-previews.service";
import { AccountingRecordUnavailable } from "@/features/accounting/backend/sealed-accounting-json";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import {
  AdministrationAgentDocuments,
  type AdministrationDocument,
} from "./administration-agent-documents";
import { administrationOperationTools } from "./administration-agent-tools";

const previewId = invoicePreviewIdSchema.make(crypto.randomUUID());
const invoiceId = invoiceIdSchema.make(crypto.randomUUID());
const expiresAt = Temporal.Instant.from("2026-11-18T10:15:00Z");
const owner = "synthetic-administrator" as CustomerAccountId;

const link = (
  document: Pick<AdministrationDocument, "reference" | "args">,
  keep: InvoicePreviews["Service"]["keep"]
) => {
  const kept: Array<unknown> = [];
  return Effect.flatMap(AdministrationAgentDocuments, (documents) =>
    documents.link({
      ...document,
      bytes: new TextEncoder().encode("%PDF-1.7 synthetic"),
      administratorAccountId: owner,
    })
  ).pipe(
    Effect.provide(
      AdministrationAgentDocuments.Default.pipe(
        Layer.provide(
          Layer.succeed(
            InvoicePreviews,
            InvoicePreviews.of({
              keep: (input) => {
                kept.push(input);
                return keep(input);
              },
              open: () => Effect.die("unused"),
            })
          )
        )
      )
    ),
    Effect.map((result) => ({ result, kept })),
    Effect.runPromise
  );
};

const keepSucceeds = () => Effect.succeed({ id: previewId, expiresAt });

describe("AdministrationAgentDocuments", () => {
  test("serves the invoice preview operation the agents' tools call", () => {
    expect(
      administrationOperationTools.map(({ reference }) => reference)
    ).toContain("administration.previewInvoice");
  });

  test("previews an unconfirmed invoice creation through the linked invoice preview", () => {
    const createInvoice = administrationOperationTools.find(
      ({ reference }) => reference === "administration.createInvoice"
    );

    expect(createInvoice?.behavior.preview).toEqual({
      _tag: "Read",
      operations: ["administration.previewInvoice"],
    });
  });

  test("keeps an invoice preview for the administrator and links its Admin UI download", async () => {
    const { result, kept } = await link(
      { reference: "administration.previewInvoice", args: { invoiceId } },
      keepSucceeds
    );

    expect(kept).toEqual([
      {
        invoiceId,
        administratorAccountId: owner,
        document: expect.any(Uint8Array),
      },
    ]);
    const linked = Option.getOrThrow(result);
    expect(new URL(linked.url).pathname).toBe(
      `/admin/invoice-previews/${previewId}`
    );
    expect(linked.expiresAt).toEqual(expiresAt);
  });

  test("links no other document and keeps nothing for it", async () => {
    const { result, kept } = await link(
      { reference: "administration.getInvoicePdf", args: { invoiceId } },
      keepSucceeds
    );

    expect(Option.isNone(result)).toBe(true);
    expect(kept).toEqual([]);
  });

  test("answers without a link when the preview can't be kept", async () => {
    const { result } = await link(
      { reference: "administration.previewInvoice", args: { invoiceId } },
      () =>
        Effect.fail(
          new AccountingRecordUnavailable({
            operation: "encrypt",
            reference: { type: "invoiceId", id: invoiceId },
            message: "Invoice preview encryption key is unavailable.",
          })
        )
    );

    expect(Option.isNone(result)).toBe(true);
  });
});
