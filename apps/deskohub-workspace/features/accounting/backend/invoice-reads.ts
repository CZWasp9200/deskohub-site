import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Data, Effect, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  correctiveDocuments,
  invoiceArchives,
  invoiceCancellations,
  invoices,
} from "@/db/schema";
import type { CorrectiveDocumentNumber } from "@/features/accounting/corrective-document";
import {
  decodeInvoiceDocument,
  type InvoiceDocument,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import type {
  InvoiceCancellationCause,
  InvoiceCancellationFact,
} from "@/features/accounting/invoice-cancellation";
import {
  type InvoiceId,
  invoiceIdSchema,
} from "@/features/accounting/manual-invoice";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import {
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { decryptAccountingSnapshot } from "./accounting-snapshot-sql";
import type {
  Invoice,
  InvoiceMetadata,
  ReservationInvoice,
} from "./invoice.repository";
import { isVisibleToCustomer } from "./invoice-visibility-sql";

export class InvoiceStorageError extends Data.TaggedError(
  "InvoiceStorageError"
)<{
  readonly operation: "decrypt" | "encrypt" | "load" | "parse" | "validate";
  readonly paymentAttemptId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Reads and decrypts stored invoices for `InvoiceRepository`. The listings
 * load every invoice side by side, which no file that opens transactions may
 * state, so they live apart from the repository's issuance transactions.
 * Called inside a transaction, as the legacy administrator backfill does,
 * they load one invoice at a time. Customer reads filter by the Dotypos
 * customer in the same SQL that decrypts, so no other customer's document is
 * ever decrypted.
 */
export const makeInvoiceReads = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const keys = yield* AccountingSnapshotKeyService;

  const loadInvoice = Effect.fn("InvoiceRepository.loadInvoice")(
    function* (input: { readonly where: SQL; readonly lookupId: string }) {
      const [metadata] = yield* db
        .select({ id: invoices.id, keyId: invoices.keyId })
        .from(invoices)
        .where(input.where)
        .limit(1);

      if (!metadata) return null;

      const key = yield* keys.getById(metadata.keyId).pipe(
        Effect.mapError(
          (cause) =>
            new InvoiceStorageError({
              operation: "decrypt",
              paymentAttemptId: input.lookupId,
              message: "Invoice decryption key is unavailable.",
              cause: censorLogValue(cause),
            })
        )
      );

      const [row] = yield* db
        .select({
          id: invoices.id,
          workspaceReservationId: invoices.workspaceReservationId,
          paymentAttemptId: invoices.paymentAttemptId,
          dotyposCustomerId: invoices.dotyposCustomerId,
          invoiceNumber: invoices.invoiceNumber,
          issuedAt: invoices.issuedAt,
          replacesInvoiceId: invoices.replacesInvoiceId,
          replacedByInvoiceId: successor.id,
          cancelledAt: invoiceCancellations.cancelledAt,
          cancellationCause: invoiceCancellations.cause,
          correctiveDocumentNumber: correctiveDocuments.documentNumber,
          archivedAt: invoiceArchives.archivedAt,
          documentJson: decryptAccountingSnapshot(
            invoices.encryptedDocument,
            key.secret
          ),
        })
        .from(invoices)
        .leftJoin(
          invoiceCancellations,
          eq(invoiceCancellations.invoiceId, invoices.id)
        )
        .leftJoin(
          correctiveDocuments,
          eq(correctiveDocuments.cancelledInvoiceId, invoices.id)
        )
        .leftJoin(invoiceArchives, eq(invoiceArchives.invoiceId, invoices.id))
        .leftJoin(successor, eq(successor.replacesInvoiceId, invoices.id))
        // The row whose key was read: a selector could match another row
        // by now, encrypted under another key.
        .where(eq(invoices.id, metadata.id))
        .limit(1)
        .pipe(
          Effect.withTracerEnabled(false),
          Effect.mapError(
            (cause) =>
              new InvoiceStorageError({
                operation: "decrypt",
                paymentAttemptId: input.lookupId,
                message: "Invoice could not be decrypted.",
                cause: censorLogValue(cause),
              })
          )
        );

      if (!row) {
        return yield* new InvoiceStorageError({
          operation: "load",
          paymentAttemptId: input.lookupId,
          message: "Invoice disappeared while loading.",
        });
      }

      const encoded = yield* Effect.try({
        try: () => JSON.parse(row.documentJson) as unknown,
        catch: () =>
          new InvoiceStorageError({
            operation: "parse",
            paymentAttemptId: input.lookupId,
            message: "Invoice JSON is invalid.",
          }),
      });
      const document = yield* decodeInvoiceDocument(encoded).pipe(
        Effect.mapError(
          () =>
            new InvoiceStorageError({
              operation: "parse",
              paymentAttemptId: input.lookupId,
              message: "Invoice schema is invalid.",
            })
        )
      );

      yield* validateStoredInvoice({ row, document });

      return {
        id: invoiceIdSchema.make(row.id),
        workspaceReservationId: row.workspaceReservationId,
        paymentAttemptId: row.paymentAttemptId,
        dotyposCustomerId: row.dotyposCustomerId,
        invoiceNumber: document.invoiceNumber,
        issuedAt: row.issuedAt,
        document,
        cancellation: yield* toCancellationFact(row, input.lookupId),
        archivedAt: row.archivedAt,
        replacesInvoiceId: row.replacesInvoiceId,
        replacedByInvoiceId: row.replacedByInvoiceId
          ? invoiceIdSchema.make(row.replacedByInvoiceId)
          : null,
      } satisfies Invoice;
    }
  );

  const findById = Effect.fn("InvoiceRepository.findById")(
    (invoiceId: string) =>
      loadInvoice({
        where: eq(invoices.id, invoiceIdSchema.make(invoiceId)),
        lookupId: invoiceId,
      })
  );

  /**
   * The payment attempt's invoice that is not cancelled. A reservation's
   * invoices form one replacement chain, so it has at most one.
   */
  const findLiveByPaymentAttemptId = Effect.fn(
    "InvoiceRepository.findLiveByPaymentAttemptId"
  )((paymentAttemptId: string) =>
    loadInvoice({
      where: and(
        eq(
          invoices.paymentAttemptId,
          paymentAttemptIdSchema.make(paymentAttemptId)
        ),
        isUncancelled
      )!,
      lookupId: paymentAttemptId,
    }).pipe(Effect.map(asReservationInvoice))
  );

  /**
   * The payment attempt's latest invoice in its replacement chain, cancelled
   * or not: no later invoice of the attempt replaces it.
   */
  const findLatestByPaymentAttemptId = Effect.fn(
    "InvoiceRepository.findLatestByPaymentAttemptId"
  )((paymentAttemptId: string) =>
    loadInvoice({
      where: and(
        eq(
          invoices.paymentAttemptId,
          paymentAttemptIdSchema.make(paymentAttemptId)
        ),
        isAttemptChainTail
      )!,
      lookupId: paymentAttemptId,
    }).pipe(Effect.map(asReservationInvoice))
  );

  /** The reservation's invoice that is not cancelled; at most one exists. */
  const findLiveByReservationId = Effect.fn(
    "InvoiceRepository.findLiveByReservationId"
  )((reservationId: WorkspaceReservationId) =>
    loadInvoice({
      where: and(
        eq(invoices.workspaceReservationId, reservationId),
        isUncancelled
      )!,
      lookupId: reservationId,
    }).pipe(Effect.map(asReservationInvoice))
  );

  /**
   * The tail of the reservation's replacement chain: its latest invoice,
   * cancelled or not.
   */
  const findLatestByReservationId = Effect.fn(
    "InvoiceRepository.findLatestByReservationId"
  )((reservationId: WorkspaceReservationId) =>
    loadInvoice({
      where: and(
        eq(invoices.workspaceReservationId, reservationId),
        isChainTail
      )!,
      lookupId: reservationId,
    }).pipe(Effect.map(asReservationInvoice))
  );

  const list = Effect.fn("InvoiceRepository.list")(function* () {
    const rows = yield* db.select({ id: invoices.id }).from(invoices);
    // ponytail: decrypting the small invoice ledger in-process keeps one
    // repository path; add SQL pagination when the ledger is measurably large.
    const loaded = yield* Effect.all(
      rows.map(({ id }) => findById(id)),
      { concurrency: "inherit" }
    );
    return loaded.filter((invoice) => invoice !== null);
  });

  const listManualInvoiceProvenance = Effect.fn(
    "InvoiceRepository.listManualInvoiceProvenance"
  )(function* () {
    const rows = yield* db
      .select({ id: invoices.id })
      .from(invoices)
      .where(isNull(invoices.workspaceReservationId));
    const loaded = yield* Effect.all(
      rows.map(({ id }) => findById(id)),
      { concurrency: "inherit" }
    );
    return loaded.flatMap((invoice) =>
      invoice && isManualInvoiceDocument(invoice.document)
        ? [
            {
              invoiceId: invoice.document.invoiceId,
              provenance: {
                source: invoice.document.provenance.source,
                actor: invoice.document.provenance.actor,
              },
            },
          ]
        : []
    );
  });

  const loadCustomerInvoice = (
    dotyposCustomerId: DotyposCustomerId,
    invoiceId: InvoiceId
  ) =>
    loadInvoice({
      // `and` of defined conditions is never undefined.
      where: and(
        eq(invoices.id, invoiceId),
        eq(invoices.dotyposCustomerId, dotyposCustomerId),
        isVisibleToCustomer()
      )!,
      lookupId: invoiceId,
    });

  /** The customer's issued invoices, newest issue first. */
  const listForCustomer = Effect.fn("InvoiceRepository.listForCustomer")(
    function* (dotyposCustomerId: DotyposCustomerId) {
      const rows = yield* db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.dotyposCustomerId, dotyposCustomerId),
            isVisibleToCustomer()
          )
        )
        .orderBy(desc(invoices.issuedAt), desc(invoices.invoiceNumber));
      const loaded = yield* Effect.all(
        rows.map(({ id }) =>
          loadCustomerInvoice(dotyposCustomerId, invoiceIdSchema.make(id))
        ),
        { concurrency: "inherit" }
      );
      return loaded.filter((invoice) => invoice !== null);
    }
  );

  /**
   * The customer's invoice metadata, oldest issue first. Selects no document
   * or key column, so nothing is decrypted.
   */
  const listMetadataForCustomer = Effect.fn(
    "InvoiceRepository.listMetadataForCustomer"
  )(function* (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly limit: number;
  }) {
    const rows: readonly InvoiceMetadata[] = yield* db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        issuedAt: invoices.issuedAt,
        numberingYear: invoices.numberingYear,
        numberingSequence: invoices.numberingSequence,
        workspaceReservationId: invoices.workspaceReservationId,
        paymentAttemptId: invoices.paymentAttemptId,
        documentSnapshotRecordedAt: accountingDocumentSnapshots.createdAt,
      })
      .from(invoices)
      .leftJoin(
        accountingDocumentSnapshots,
        eq(
          accountingDocumentSnapshots.paymentAttemptId,
          invoices.paymentAttemptId
        )
      )
      .where(eq(invoices.dotyposCustomerId, input.dotyposCustomerId))
      .orderBy(asc(invoices.issuedAt), asc(invoices.id))
      .limit(readLimitSentinel(input.limit));
    return yield* requireWithinReadLimit(rows, input.limit);
  });

  /**
   * One of the customer's invoices. Another customer's invoice, an unknown id,
   * and text that is no invoice id all read as `null`; the last one without a
   * query.
   */
  const findForCustomer = Effect.fn("InvoiceRepository.findForCustomer")(
    (dotyposCustomerId: DotyposCustomerId, invoiceId: string) =>
      Option.match(decodeInvoiceId(invoiceId), {
        onNone: () => Effect.succeed(null),
        onSome: (id) => loadCustomerInvoice(dotyposCustomerId, id),
      })
  );

  return {
    findById,
    findForCustomer,
    findLatestByPaymentAttemptId,
    findLatestByReservationId,
    findLiveByPaymentAttemptId,
    findLiveByReservationId,
    list,
    listForCustomer,
    listManualInvoiceProvenance,
    listMetadataForCustomer,
  };
});

const decodeInvoiceId = Schema.decodeUnknownOption(invoiceIdSchema);

/** A later invoice of the same chain that replaces the read one. */
const successor = alias(invoices, "successor");

/** No cancellation is recorded for the invoice. */
const isUncancelled = sql`not exists (select 1 from ${invoiceCancellations} where ${invoiceCancellations.invoiceId} = ${invoices.id})`;

const chainSuccessor = sql.identifier("chain_successor");
const successorColumn = (column: { readonly name: string }) =>
  sql`${chainSuccessor}.${sql.identifier(column.name)}`;

/**
 * No later invoice replaces the invoice: it is its chain's tail. The chain's
 * links, not issue times, decide its order.
 */
export const isChainTail = sql`not exists (select 1 from ${invoices} ${chainSuccessor} where ${successorColumn(invoices.replacesInvoiceId)} = ${invoices.id})`;

/** No later invoice of the same payment attempt replaces the invoice. */
const isAttemptChainTail = sql`not exists (select 1 from ${invoices} ${chainSuccessor} where ${successorColumn(invoices.replacesInvoiceId)} = ${invoices.id} and ${successorColumn(invoices.paymentAttemptId)} = ${invoices.paymentAttemptId})`;

/**
 * A cancellation and its corrective document are recorded together, so a
 * cancelled invoice without its document number is corrupt.
 */
const toCancellationFact = Effect.fn("InvoiceRepository.toCancellationFact")(
  function* (
    row: {
      readonly cancelledAt: Temporal.Instant | null;
      readonly cancellationCause: InvoiceCancellationCause | null;
      readonly correctiveDocumentNumber: CorrectiveDocumentNumber | null;
    },
    lookupId: string
  ) {
    if (row.cancelledAt === null) return null;
    if (
      row.cancellationCause === null ||
      row.correctiveDocumentNumber === null
    ) {
      return yield* new InvoiceStorageError({
        operation: "validate",
        paymentAttemptId: lookupId,
        message: "Invoice cancellation has no corrective document.",
      });
    }
    return {
      cancelledAt: row.cancelledAt,
      cause: row.cancellationCause,
      correctiveDocumentNumber: row.correctiveDocumentNumber,
    } satisfies InvoiceCancellationFact;
  }
);

/** The invoice when it is a reservation invoice, else `null`. */
export const asReservationInvoice = (invoice: Invoice | null) =>
  invoice && !isManualInvoiceDocument(invoice.document)
    ? ({ ...invoice, document: invoice.document } as ReservationInvoice)
    : null;

interface StoredInvoiceRow {
  readonly id: string;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string | null;
  readonly dotyposCustomerId: string;
  readonly invoiceNumber: string;
  readonly issuedAt: Temporal.Instant;
}

interface StoredInvoice {
  readonly row: StoredInvoiceRow;
  readonly document: InvoiceDocument;
}

const matchesInvoiceIdentity = ({ document, row }: StoredInvoice) =>
  document.dotyposCustomerId === row.dotyposCustomerId &&
  document.invoiceNumber === row.invoiceNumber &&
  Temporal.Instant.compare(
    Temporal.Instant.from(document.issuedAt),
    row.issuedAt
  ) === 0;

const matchesInvoiceSource = ({ document, row }: StoredInvoice) =>
  isManualInvoiceDocument(document)
    ? document.invoiceId === row.id &&
      row.workspaceReservationId === null &&
      row.paymentAttemptId === null
    : document.workspaceReservationId === row.workspaceReservationId &&
      document.paymentAttemptId === row.paymentAttemptId;

const validateStoredInvoice = Effect.fn(
  "InvoiceRepository.validateStoredInvoice"
)(function* (input: StoredInvoice) {
  if (!matchesInvoiceIdentity(input) || !matchesInvoiceSource(input)) {
    return yield* new InvoiceStorageError({
      operation: "validate",
      paymentAttemptId: input.row.paymentAttemptId ?? input.row.id,
      message: "Invoice metadata does not match its encrypted document.",
    });
  }
});
