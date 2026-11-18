import { and, eq, gt, lte, sql } from "drizzle-orm";
import { Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoicePreviews } from "@/db/schema/invoice-previews";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { sealedAccountingJson } from "@/features/accounting/backend/sealed-accounting-json";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { InvoicePreviewId } from "./invoice-preview-id";

/** How long a kept preview can be opened. */
const invoicePreviewLifetime = Duration.minutes(15);

const keptPreviewSchema = Schema.Struct({
  /** The rendered PDF, stored base64-encoded. */
  pdf: Schema.Uint8ArrayFromBase64,
});

const encodeKeptPreview = Schema.encodeSync(keptPreviewSchema);

/** A preview the administrator who asked for it can open until it expires. */
interface KeptInvoicePreview {
  readonly id: InvoicePreviewId;
  readonly expiresAt: Temporal.Instant;
}

interface OpenedInvoicePreview {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

const makeInvoicePreviews = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const sealed = yield* sealedAccountingJson({
    label: "Invoice preview",
    table: invoicePreviews,
    keyId: invoicePreviews.keyId,
    ciphertext: invoicePreviews.encryptedDocument,
    plaintext: { invoiceId: invoicePreviews.invoiceId },
    encode: encodeKeptPreview,
    schema: keptPreviewSchema,
  });

  // The database clock decides expiry, for writing and reading alike.
  const deleteExpired = Effect.suspend(() =>
    db.delete(invoicePreviews).where(lte(invoicePreviews.expiresAt, sql`now()`))
  );

  /**
   * Keeps a rendered preview, encrypted, for `invoicePreviewLifetime`, and
   * deletes every expired one.
   */
  const keep = Effect.fn("InvoicePreviews.keep")(function* (input: {
    readonly invoiceId: InvoiceId;
    readonly administratorAccountId: CustomerAccountId;
    readonly document: Uint8Array;
  }) {
    const reference = { type: "invoiceId", id: input.invoiceId } as const;
    const sealer = yield* sealed.sealer(reference);
    yield* deleteExpired;
    const lifetimeSeconds = Duration.toSeconds(invoicePreviewLifetime);
    const [kept] = yield* sealer.seal({
      reference,
      value: { pdf: input.document },
      insert: ({ keyId, ciphertext }) =>
        db
          .insert(invoicePreviews)
          .values({
            invoiceId: input.invoiceId,
            administratorAccountId: input.administratorAccountId,
            keyId,
            encryptedDocument: ciphertext,
            expiresAt: sql`now() + make_interval(secs => ${lifetimeSeconds})`,
          })
          .returning({
            id: invoicePreviews.id,
            expiresAt: invoicePreviews.expiresAt,
          }),
    });
    if (kept === undefined) {
      // An insert that succeeded returns its row.
      return yield* Effect.die(new Error("The kept preview returned no row."));
    }
    return kept satisfies KeptInvoicePreview;
  });

  /**
   * Opens a preview that hasn't expired, only for the administrator who
   * asked for it; any other preview reads as none.
   */
  const open = Effect.fn("InvoicePreviews.open")(function* (input: {
    readonly id: InvoicePreviewId;
    readonly administratorAccountId: CustomerAccountId;
  }) {
    yield* deleteExpired;
    const opened = yield* sealed.open({
      reference: { type: "invoicePreviewId", id: input.id },
      where: and(
        eq(invoicePreviews.id, input.id),
        eq(
          invoicePreviews.administratorAccountId,
          input.administratorAccountId
        ),
        gt(invoicePreviews.expiresAt, sql`now()`)
      )!,
    });
    if (opened === null) return Option.none<OpenedInvoicePreview>();
    return Option.some<OpenedInvoicePreview>({
      bytes: opened.value.pdf,
      fileName: `${opened.plaintext.invoiceId}-preview.pdf`,
    });
  });

  return { keep, open };
});

/**
 * Rendered invoice previews kept briefly for the Admin UI download an
 * administrator's AI agent links to. Keeping one issues nothing.
 */
export class InvoicePreviews extends Context.Service<
  InvoicePreviews,
  Effect.Success<typeof makeInvoicePreviews>
>()("@deskohub-workspace/accounting/InvoicePreviews") {
  static Default = Layer.effect(this, makeInvoicePreviews);
  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        AccountingSnapshotKeyService.Default
      )
    )
  );
}
