import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import {
  WorkspaceDatabase,
  workspaceStatementConcurrency,
} from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  correctiveDocuments,
  invoiceArchives,
  invoiceCancellations,
  invoices,
} from "@/db/schema";
import type { CorrectiveDocumentNumber } from "@/features/accounting/corrective-document";
import {
  type InvoiceDocument,
  invoiceDocumentSchema,
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
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import type {
  Invoice,
  InvoiceMetadata,
  ReservationInvoice,
  UnreadableInvoice,
} from "./invoice.repository";
import { isVisibleToCustomer } from "./invoice-visibility-sql";
import {
  type AccountingRecordReference,
  AccountingRecordUnavailable,
  sealedAccountingJson,
} from "./sealed-accounting-json";

/** Issued invoice documents, sealed beside their numbering and sources. */
export const sealedInvoiceDocuments = sealedAccountingJson({
  label: "Invoice",
  table: invoices,
  keyId: invoices.keyId,
  ciphertext: invoices.encryptedDocument,
  plaintext: {
    id: invoices.id,
    workspaceReservationId: invoices.workspaceReservationId,
    paymentAttemptId: invoices.paymentAttemptId,
    dotyposCustomerId: invoices.dotyposCustomerId,
    invoiceNumber: invoices.invoiceNumber,
    issuedAt: invoices.issuedAt,
  },
  encode: (document: InvoiceDocument) => document,
  schema: invoiceDocumentSchema,
});

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
  const sealedDocuments = yield* sealedInvoiceDocuments;

  /**
   * The cancellation, archive and chain links of the first invoice the
   * selector matches, beside its unencrypted numbering. Decrypts nothing.
   */
  const readStanding = (where: SQL) =>
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issuedAt: invoices.issuedAt,
        replacesInvoiceId: invoices.replacesInvoiceId,
        replacedByInvoiceId: successor.id,
        cancelledAt: invoiceCancellations.cancelledAt,
        cancellationCause: invoiceCancellations.cause,
        correctiveDocumentNumber: correctiveDocuments.documentNumber,
        archivedAt: invoiceArchives.archivedAt,
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
      .where(where)
      .limit(1);

  /**
   * Reads the standing of the first invoice the selector matches, then opens
   * that row's document while the selector still matches it. `moved` when the
   * row stopped matching in between, as when a live invoice is cancelled.
   */
  const loadMatchingInvoice = Effect.fn(
    "InvoiceRepository.loadMatchingInvoice"
  )(function* (input: {
    readonly where: SQL;
    readonly reference: AccountingRecordReference;
  }) {
    const [standing] = yield* readStanding(input.where);

    if (!standing) return null;

    // The row whose standing was read, while it still matches: by now the
    // selector could match another row, encrypted under another key, or none.
    const opened = yield* sealedDocuments
      .open({
        reference: input.reference,
        // `and` of defined conditions is never undefined.
        where: and(eq(invoices.id, standing.id), input.where)!,
      })
      .pipe(
        Effect.catchTag("AccountingRecordUnavailable", (cause) =>
          cause.operation === "load" ? Effect.succeed(null) : Effect.fail(cause)
        )
      );

    // Invoices are never deleted, so the row stopped matching.
    if (!opened) return "moved" as const;

    const { value: document, plaintext: row } = opened;
    yield* validateStoredInvoice({ row, document });

    return {
      id: invoiceIdSchema.make(row.id),
      workspaceReservationId: row.workspaceReservationId,
      paymentAttemptId: row.paymentAttemptId,
      dotyposCustomerId: row.dotyposCustomerId,
      invoiceNumber: document.invoiceNumber,
      issuedAt: row.issuedAt,
      document,
      cancellation: yield* toCancellationFact(standing, input.reference),
      archivedAt: standing.archivedAt,
      replacesInvoiceId: standing.replacesInvoiceId,
      replacedByInvoiceId: standing.replacedByInvoiceId
        ? invoiceIdSchema.make(standing.replacedByInvoiceId)
        : null,
    } satisfies Invoice;
  });

  /**
   * The invoice the selector matches, read consistently: its cancellation,
   * archive and chain links are those of the matching row. A row that stops
   * matching while it loads is looked up once more, then reads as `null`.
   */
  const loadInvoice = Effect.fn("InvoiceRepository.loadInvoice")(
    function* (input: {
      readonly where: SQL;
      readonly reference: AccountingRecordReference;
    }) {
      const first = yield* loadMatchingInvoice(input);
      if (first !== "moved") return first;
      const second = yield* loadMatchingInvoice(input);
      return second === "moved" ? null : second;
    }
  );

  const findById = Effect.fn("InvoiceRepository.findById")(
    (invoiceId: string) => {
      const id = invoiceIdSchema.make(invoiceId);
      return loadInvoice({
        where: eq(invoices.id, id),
        reference: { type: "invoiceId", id },
      });
    }
  );

  /**
   * The payment attempt's invoice that is not cancelled. A reservation's
   * invoices form one replacement chain, so it has at most one.
   */
  const findLiveByPaymentAttemptId = Effect.fn(
    "InvoiceRepository.findLiveByPaymentAttemptId"
  )((paymentAttemptId: string) => {
    const id = paymentAttemptIdSchema.make(paymentAttemptId);
    return loadInvoice({
      where: and(eq(invoices.paymentAttemptId, id), isUncancelled)!,
      reference: { type: "paymentAttemptId", id },
    }).pipe(Effect.map(asReservationInvoice));
  });

  /**
   * The payment attempt's latest invoice in its replacement chain, cancelled
   * or not: no later invoice of the attempt replaces it.
   */
  const findLatestByPaymentAttemptId = Effect.fn(
    "InvoiceRepository.findLatestByPaymentAttemptId"
  )((paymentAttemptId: string) => {
    const id = paymentAttemptIdSchema.make(paymentAttemptId);
    return loadInvoice({
      where: and(eq(invoices.paymentAttemptId, id), isAttemptChainTail)!,
      reference: { type: "paymentAttemptId", id },
    }).pipe(Effect.map(asReservationInvoice));
  });

  /** The reservation's invoice that is not cancelled; at most one exists. */
  const findLiveByReservationId = Effect.fn(
    "InvoiceRepository.findLiveByReservationId"
  )((reservationId: WorkspaceReservationId) =>
    loadInvoice({
      where: and(
        eq(invoices.workspaceReservationId, reservationId),
        isUncancelled
      )!,
      reference: { type: "workspaceReservationId", id: reservationId },
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
      reference: { type: "workspaceReservationId", id: reservationId },
    }).pipe(Effect.map(asReservationInvoice))
  );

  const list = Effect.fn("InvoiceRepository.list")(function* () {
    const rows = yield* db.select({ id: invoices.id }).from(invoices);
    // ponytail: decrypting the small invoice ledger in-process keeps one
    // repository path; add SQL pagination when the ledger is measurably large.
    const loaded = yield* Effect.flatMap(
      workspaceStatementConcurrency,
      (concurrency) =>
        Effect.all(
          rows.map(({ id }) => findById(id)),
          { concurrency }
        )
    );
    return loaded.filter((invoice) => invoice !== null);
  });

  /** The invoice's unencrypted columns and standing, for one whose document cannot be opened. */
  const readUnreadable = Effect.fn("InvoiceRepository.readUnreadable")(
    function* (id: InvoiceId) {
      const [standing] = yield* readStanding(eq(invoices.id, id));
      if (!standing) return null;
      return {
        id,
        invoiceNumber: standing.invoiceNumber,
        issuedAt: standing.issuedAt,
        cancellation: yield* toCancellationFact(standing, {
          type: "invoiceId",
          id,
        }),
        archivedAt: standing.archivedAt,
        replacesInvoiceId: standing.replacesInvoiceId,
        replacedByInvoiceId: standing.replacedByInvoiceId
          ? invoiceIdSchema.make(standing.replacedByInvoiceId)
          : null,
      } satisfies UnreadableInvoice;
    }
  );

  const listWithUnreadable = Effect.fn("InvoiceRepository.listWithUnreadable")(
    function* () {
      const rows = yield* db.select({ id: invoices.id }).from(invoices);
      const loaded = yield* Effect.flatMap(
        workspaceStatementConcurrency,
        (concurrency) =>
          Effect.all(
            rows.map(({ id }) =>
              findById(id).pipe(
                Effect.map((invoice) => invoice && { readable: invoice }),
                // Whatever keeps the document from opening (a foreign key, a
                // missing key, a document that disagrees with its row), the
                // unencrypted columns still name the invoice. A failing database
                // fails the listing: it reports no AccountingRecordUnavailable.
                Effect.catchTag("AccountingRecordUnavailable", () =>
                  readUnreadable(invoiceIdSchema.make(id)).pipe(
                    Effect.map((invoice) => invoice && { unreadable: invoice })
                  )
                )
              )
            ),
            { concurrency }
          )
      );
      return {
        readable: loaded.flatMap((entry) =>
          entry && "readable" in entry ? [entry.readable] : []
        ),
        unreadable: loaded.flatMap((entry) =>
          entry && "unreadable" in entry ? [entry.unreadable] : []
        ),
      };
    }
  );

  const listManualInvoiceProvenance = Effect.fn(
    "InvoiceRepository.listManualInvoiceProvenance"
  )(function* () {
    const rows = yield* db
      .select({ id: invoices.id })
      .from(invoices)
      .where(isNull(invoices.workspaceReservationId));
    const loaded = yield* Effect.flatMap(
      workspaceStatementConcurrency,
      (concurrency) =>
        Effect.all(
          rows.map(({ id }) => findById(id)),
          { concurrency }
        )
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
      reference: { type: "invoiceId", id: invoiceId },
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
      const loaded = yield* Effect.flatMap(
        workspaceStatementConcurrency,
        (concurrency) =>
          Effect.all(
            rows.map(({ id }) =>
              loadCustomerInvoice(dotyposCustomerId, invoiceIdSchema.make(id))
            ),
            { concurrency }
          )
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
    const rows = yield* db
      .select({
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issuedAt: invoices.issuedAt,
        numberingYear: invoices.numberingYear,
        numberingSequence: invoices.numberingSequence,
        workspaceReservationId: invoices.workspaceReservationId,
        paymentAttemptId: invoices.paymentAttemptId,
        documentSnapshotRecordedAt: accountingDocumentSnapshots.createdAt,
        cancelledAt: invoiceCancellations.cancelledAt,
        cancellationCause: invoiceCancellations.cause,
        correctiveDocumentNumber: correctiveDocuments.documentNumber,
        archivedAt: invoiceArchives.archivedAt,
      })
      .from(invoices)
      .leftJoin(
        accountingDocumentSnapshots,
        eq(
          accountingDocumentSnapshots.paymentAttemptId,
          invoices.paymentAttemptId
        )
      )
      .leftJoin(
        invoiceCancellations,
        eq(invoiceCancellations.invoiceId, invoices.id)
      )
      .leftJoin(
        correctiveDocuments,
        eq(correctiveDocuments.cancelledInvoiceId, invoices.id)
      )
      .leftJoin(invoiceArchives, eq(invoiceArchives.invoiceId, invoices.id))
      .where(eq(invoices.dotyposCustomerId, input.dotyposCustomerId))
      .orderBy(asc(invoices.issuedAt), asc(invoices.id))
      .limit(readLimitSentinel(input.limit));
    const bounded = yield* requireWithinReadLimit(rows, input.limit);
    return yield* Effect.forEach(
      bounded,
      ({
        invoiceId,
        cancelledAt,
        cancellationCause,
        correctiveDocumentNumber,
        ...row
      }): Effect.Effect<InvoiceMetadata, AccountingRecordUnavailable> =>
        toCancellationFact(
          { cancelledAt, cancellationCause, correctiveDocumentNumber },
          { type: "invoiceId", id: invoiceIdSchema.make(invoiceId) }
        ).pipe(Effect.map((cancellation) => ({ ...row, cancellation })))
    );
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
    listWithUnreadable,
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
    reference: AccountingRecordReference
  ) {
    if (row.cancelledAt === null) return null;
    if (
      row.cancellationCause === null ||
      row.correctiveDocumentNumber === null
    ) {
      return yield* new AccountingRecordUnavailable({
        operation: "validate",
        reference,
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
  readonly paymentAttemptId: PaymentAttemptId | null;
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

const storedInvoiceReference = (
  row: StoredInvoiceRow
): AccountingRecordReference =>
  row.paymentAttemptId === null
    ? { type: "invoiceId", id: invoiceIdSchema.make(row.id) }
    : { type: "paymentAttemptId", id: row.paymentAttemptId };

const validateStoredInvoice = Effect.fn(
  "InvoiceRepository.validateStoredInvoice"
)(function* (input: StoredInvoice) {
  if (!matchesInvoiceIdentity(input) || !matchesInvoiceSource(input)) {
    return yield* new AccountingRecordUnavailable({
      operation: "validate",
      reference: storedInvoiceReference(input.row),
      message: "Invoice metadata does not match its encrypted document.",
    });
  }
});
