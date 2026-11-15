import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, exists } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  invoiceCancellations,
  invoiceNumberCounters,
  invoices,
  manualInvoiceActors,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { WorkspaceLocks } from "@/db/workspace-locks";
import {
  formatInvoiceNumber,
  getInvoiceNumberingYear,
  getInvoiceVariableSymbol,
  type InvoiceBuyer,
  type InvoiceDocument,
  type InvoiceNumber,
  invoiceBuyerSchema,
  invoiceDocumentSchema,
  isManualInvoiceDocument,
  type ManualInvoiceDocument,
  makeInvoiceDocument,
  makeManualInvoiceDocument,
} from "@/features/accounting/invoice";
import type { InvoiceCancellationFact } from "@/features/accounting/invoice-cancellation";
import {
  type InvoiceId,
  isInvoiceCurrencyPayable,
  type ManualInvoiceInput,
  type ManualInvoiceProvenance,
  ManualInvoiceValidationError,
  manualInvoiceInputSchema,
  type NormalizedManualInvoiceInput,
  normalizeManualInvoiceInput,
} from "@/features/accounting/manual-invoice";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import type { ReadLimitExceededError } from "@/shared/backend/read-limit";
import {
  AccountingDocumentSnapshotRepository,
  type AccountingDocumentSnapshotStorageError,
} from "./accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { encryptAccountingSnapshot } from "./accounting-snapshot-sql";
import { allocateAnnualNumber } from "./document-numbering";
import { isFulfilledReservation } from "./invoice-eligibility";
import {
  asReservationInvoice,
  InvoiceStorageError,
  isChainTail,
  makeInvoiceReads,
} from "./invoice-reads";

class InvoiceEligibilityError extends Data.TaggedError(
  "InvoiceEligibilityError"
)<{
  readonly paymentAttemptId: string;
  /** Set when the reservation is being cancelled or is cancelled. */
  readonly reason?: "reservation_cancelled";
  readonly message: string;
}> {}

class ManualInvoiceConflictError extends Data.TaggedError(
  "ManualInvoiceConflictError"
)<{
  readonly invoiceId: string;
  readonly message: string;
}> {}

export interface Invoice {
  readonly id: InvoiceId;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string | null;
  readonly dotyposCustomerId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly document: InvoiceDocument;
  /** `null` while the invoice is live. */
  readonly cancellation: InvoiceCancellationFact | null;
  /** When an administrator hid the cancelled invoice from the administration UI. */
  readonly archivedAt: Temporal.Instant | null;
  /** The cancelled invoice of the same reservation that this one replaces. */
  readonly replacesInvoiceId: InvoiceId | null;
  /** The invoice that replaced this cancelled one. */
  readonly replacedByInvoiceId: InvoiceId | null;
}

/**
 * An issued invoice's numbering and source references, read without its
 * document: no decryption, no encrypted bytes and no key id.
 * `documentSnapshotRecordedAt` is when the accounting snapshot of a
 * reservation invoice's payment attempt was recorded; a manual invoice has
 * none. `cancellation` carries no actor; `archivedAt` is when the
 * administration hid the cancelled invoice from its own list.
 */
export interface InvoiceMetadata {
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly numberingYear: number;
  readonly numberingSequence: number;
  readonly workspaceReservationId: WorkspaceReservationId | null;
  readonly paymentAttemptId: PaymentAttemptId | null;
  readonly documentSnapshotRecordedAt: Temporal.Instant | null;
  readonly cancellation: InvoiceCancellationFact | null;
  readonly archivedAt: Temporal.Instant | null;
}

interface InvoiceIssuance {
  readonly invoice: Invoice;
  readonly changed: boolean;
}

export interface ReservationInvoice extends Invoice {
  readonly workspaceReservationId: string;
  readonly paymentAttemptId: string;
  readonly document: Exclude<InvoiceDocument, ManualInvoiceDocument>;
}

interface ReservationInvoiceIssuance extends InvoiceIssuance {
  readonly invoice: ReservationInvoice;
}

export interface ManualInvoiceIssuance extends InvoiceIssuance {
  readonly invoice: Invoice & {
    readonly workspaceReservationId: null;
    readonly paymentAttemptId: null;
    readonly document: ManualInvoiceDocument;
  };
}

export type InvoiceRepositoryError =
  | AccountingDocumentSnapshotStorageError
  | EffectDrizzleQueryError
  | InvoiceEligibilityError
  | InvoiceStorageError
  | ManualInvoiceConflictError
  | ManualInvoiceValidationError
  | SqlError;

type ManualInvoiceIssueInput = ManualInvoiceInput & {
  readonly issuedBy: AdministratorAccountActor;
};

export interface IInvoiceRepository {
  readonly findById: (
    invoiceId: string
  ) => Effect.Effect<
    Invoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /** The payment attempt's live invoice: the one not cancelled. */
  readonly findLiveByPaymentAttemptId: (
    paymentAttemptId: string
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /** The payment attempt's most recently issued invoice, cancelled or not. */
  readonly findLatestByPaymentAttemptId: (
    paymentAttemptId: string
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /** The reservation's live invoice; the database allows at most one. */
  readonly findLiveByReservationId: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /** The tail of the reservation's replacement chain, cancelled or not. */
  readonly findLatestByReservationId: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /**
   * Issues the reservation invoice of the payment attempt. A retry returns
   * the live invoice. When the reservation's latest invoice is cancelled, it
   * issues a replacement with a new number that links its predecessor. It
   * refuses while the reservation is being cancelled or is cancelled.
   */
  readonly issue: (input: {
    readonly paymentAttemptId: string;
    readonly buyer: InvoiceBuyer;
    readonly provenance?: {
      readonly source: "reservation-request" | "post-order-link";
    };
  }) => Effect.Effect<ReservationInvoiceIssuance, InvoiceRepositoryError>;
  /**
   * Issues a manual invoice and records the administrator account that
   * issued it in the same transaction. A retry returns the issued invoice.
   */
  readonly issueManual: (
    input: ManualInvoiceIssueInput
  ) => Effect.Effect<ManualInvoiceIssuance, InvoiceRepositoryError>;
  /**
   * Finds one invoice of the Dotypos customer; another customer's invoice,
   * an unknown id, and text that is no invoice id all read as `null`.
   */
  readonly findForCustomer: (
    dotyposCustomerId: DotyposCustomerId,
    invoiceId: string
  ) => Effect.Effect<
    Invoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /**
   * Decrypts the Dotypos customer's invoices, newest issue first, and no
   * other customer's.
   */
  readonly listForCustomer: (
    dotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<
    readonly Invoice[],
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /**
   * The Dotypos customer's invoice metadata, oldest issue first, scoped by
   * the invoice's own customer column. Decrypts nothing. Fails with
   * `ReadLimitExceededError`, returning no rows, when the customer has more
   * than `limit` invoices.
   */
  readonly listMetadataForCustomer: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly limit: number;
  }) => Effect.Effect<
    readonly InvoiceMetadata[],
    EffectDrizzleQueryError | ReadLimitExceededError | InvoiceStorageError
  >;
  /** Decrypts every invoice. */
  readonly list: () => Effect.Effect<
    readonly Invoice[],
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /** Decrypts every manual invoice to read who issued it, and through what. */
  readonly listManualInvoiceProvenance: () => Effect.Effect<
    readonly {
      readonly invoiceId: InvoiceId;
      readonly provenance: ManualInvoiceProvenance;
    }[],
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  readonly getSuggestedVariableSymbol: () => Effect.Effect<
    string,
    EffectDrizzleQueryError
  >;
}

interface InvoiceNumbering {
  readonly key: AccountingSnapshotKey;
  readonly issuedAt: Temporal.Instant;
  readonly numberingYear: number;
  readonly numberingSequence: number;
  readonly invoiceNumber: InvoiceNumber;
}

const invoiceStorage = Layer.merge(
  WorkspaceDatabase.Default,
  AccountingSnapshotKeyService.Default
);

export class InvoiceRepository extends Context.Service<
  InvoiceRepository,
  IInvoiceRepository
>()("@deskohub-workspace/accounting/InvoiceRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
      const keys = yield* AccountingSnapshotKeyService;
      const reads = yield* makeInvoiceReads;
      const { findById, findLiveByPaymentAttemptId } = reads;

      /**
       * Takes the next number of the issue year's counter, together with the
       * active key that will encrypt the invoice. Runs in the issuing
       * transaction, so a rollback returns the number.
       */
      const allocateInvoiceNumber = Effect.fnUntraced(function* (
        invoiceId: string
      ) {
        const key = yield* keys.getActive.pipe(
          Effect.mapError(
            (cause) =>
              new InvoiceStorageError({
                operation: "encrypt",
                paymentAttemptId: invoiceId,
                message: "Invoice encryption key is unavailable.",
                cause: censorLogValue(cause),
              })
          )
        );
        const allocated = yield* allocateAnnualNumber(
          invoiceNumberCounters
        ).pipe(
          Effect.catchTag("DocumentNumberAllocationError", ({ message }) =>
            Effect.fail(
              new InvoiceStorageError({
                operation: "load",
                paymentAttemptId: invoiceId,
                message,
              })
            )
          )
        );

        return {
          key,
          issuedAt: allocated.issuedAt,
          numberingYear: allocated.numberingYear,
          numberingSequence: allocated.numberingSequence,
          invoiceNumber: formatInvoiceNumber({
            year: allocated.numberingYear,
            sequence: allocated.numberingSequence,
          }),
        } satisfies InvoiceNumbering;
      });

      const insertEncryptedInvoice = (input: {
        readonly invoiceId: string;
        readonly source: Pick<
          typeof invoices.$inferInsert,
          | "id"
          | "workspaceReservationId"
          | "paymentAttemptId"
          | "dotyposCustomerId"
          | "replacesInvoiceId"
        >;
        readonly numbering: InvoiceNumbering;
        readonly document: InvoiceDocument;
      }) =>
        db
          .insert(invoices)
          .values({
            ...input.source,
            invoiceNumber: input.numbering.invoiceNumber,
            numberingYear: input.numbering.numberingYear,
            numberingSequence: input.numbering.numberingSequence,
            keyId: input.numbering.key.id,
            encryptedDocument: encryptAccountingSnapshot(
              JSON.stringify(input.document),
              input.numbering.key.secret
            ),
            issuedAt: input.numbering.issuedAt,
          })
          .returning({ id: invoices.id })
          .pipe(
            Effect.withTracerEnabled(false),
            Effect.mapError(
              (cause) =>
                new InvoiceStorageError({
                  operation: "encrypt",
                  paymentAttemptId: input.invoiceId,
                  message: "Invoice could not be encrypted.",
                  cause: censorLogValue(cause),
                })
            )
          );

      const issue = Effect.fn("InvoiceRepository.issue")(function* (input: {
        readonly paymentAttemptId: string;
        readonly buyer: InvoiceBuyer;
        readonly provenance?: {
          readonly source: "reservation-request" | "post-order-link";
        };
      }) {
        const paymentAttemptId = paymentAttemptIdSchema.make(
          input.paymentAttemptId
        );
        const alreadyIssued =
          yield* findLiveByPaymentAttemptId(paymentAttemptId);
        if (alreadyIssued) {
          return { invoice: alreadyIssued, changed: false };
        }

        const source =
          yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
        if (!source) {
          return yield* new InvoiceEligibilityError({
            paymentAttemptId,
            message: "A payment-time accounting snapshot is required.",
          });
        }

        const buyer = yield* Schema.decodeUnknownEffect(invoiceBuyerSchema, {
          onExcessProperty: "error",
        })(input.buyer).pipe(
          Effect.mapError(
            () =>
              new InvoiceEligibilityError({
                paymentAttemptId,
                message: "Complete invoice buyer billing details are required.",
              })
          )
        );

        const outcome = yield* transaction(
          Effect.gen(function* () {
            const [locked] = yield* db
              .select({
                reservationId: workspaceReservations.id,
                reservationPaymentState: workspaceReservations.paymentState,
                activePaymentAttemptId:
                  workspaceReservations.activePaymentAttemptId,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                paidAt: workspaceReservations.paidAt,
                fulfillmentState: workspaceReservations.fulfillmentState,
                fulfilledAt: workspaceReservations.fulfilledAt,
                reservationState: workspaceReservations.reservationState,
                paymentAttemptState: paymentAttempts.state,
              })
              .from(paymentAttempts)
              .innerJoin(
                workspaceReservations,
                eq(
                  workspaceReservations.id,
                  paymentAttempts.workspaceReservationId
                )
              )
              .where(eq(paymentAttempts.id, paymentAttemptId))
              .limit(1)
              .for("update");

            if (!locked) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "The payment attempt does not exist."
              );
            }

            // The reservation row lock serializes issuances, so the chain
            // tail read here stays the tail.
            const [latest] = yield* db
              .select({
                id: invoices.id,
                paymentAttemptId: invoices.paymentAttemptId,
                cancelled: exists(
                  db
                    .select({ invoiceId: invoiceCancellations.invoiceId })
                    .from(invoiceCancellations)
                    .where(eq(invoiceCancellations.invoiceId, invoices.id))
                ),
              })
              .from(invoices)
              .where(
                and(
                  eq(invoices.workspaceReservationId, locked.reservationId),
                  isChainTail
                )
              )
              .limit(1);

            if (latest && !latest.cancelled) {
              if (latest.paymentAttemptId !== paymentAttemptId) {
                return yield* wrapInvoiceEligibilityError(
                  paymentAttemptId,
                  "The reservation was invoiced from a different payment attempt."
                );
              }

              return { invoiceId: latest.id, changed: false };
            }

            if (isCancellingReservation(locked)) {
              return yield* new InvoiceEligibilityError({
                paymentAttemptId,
                reason: "reservation_cancelled",
                message:
                  "A reservation that is being cancelled or is cancelled can't be invoiced.",
              });
            }

            if (!isActivePaidAttempt(locked, paymentAttemptId)) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "Only the active paid attempt of a paid reservation can be invoiced."
              );
            }

            if (!isFulfilledReservation(locked)) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "Only a reservation whose access code has been delivered can be invoiced."
              );
            }

            if (!snapshotMatchesLockedReservation(source, locked)) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "The accounting snapshot does not match the paid reservation."
              );
            }

            const numbering = yield* allocateInvoiceNumber(paymentAttemptId);
            const document = yield* Schema.decodeUnknownEffect(
              invoiceDocumentSchema,
              { onExcessProperty: "error" }
            )(
              makeInvoiceDocument({
                source,
                buyer,
                paymentAttemptId,
                invoiceNumber: numbering.invoiceNumber,
                issuedAt: numbering.issuedAt,
                fulfilledAt: locked.fulfilledAt,
                paidAt: locked.paidAt,
                provenance: input.provenance,
              })
            ).pipe(
              Effect.mapError(
                () =>
                  new InvoiceStorageError({
                    operation: "validate",
                    paymentAttemptId,
                    message: "Invoice schema is invalid.",
                  })
              )
            );

            const [inserted] = yield* insertEncryptedInvoice({
              invoiceId: paymentAttemptId,
              source: {
                workspaceReservationId: locked.reservationId,
                paymentAttemptId,
                dotyposCustomerId: locked.dotyposCustomerId,
                // A cancelled tail is replaced; the root has no predecessor.
                replacesInvoiceId: latest?.id ?? null,
              },
              numbering,
              document,
            });
            if (!inserted) {
              return yield* new InvoiceStorageError({
                operation: "load",
                paymentAttemptId,
                message: "Issued invoice returned no row.",
              });
            }

            return { invoiceId: inserted.id, changed: true };
          })
        );

        const invoice = yield* findById(outcome.invoiceId).pipe(
          Effect.map(asReservationInvoice)
        );
        if (!invoice) {
          return yield* new InvoiceStorageError({
            operation: "load",
            paymentAttemptId,
            message: "Issued invoice could not be loaded.",
          });
        }

        return { invoice, changed: outcome.changed };
      });

      const issueManual = Effect.fn("InvoiceRepository.issueManual")(function* (
        issueInput: ManualInvoiceIssueInput
      ) {
        const { issuedBy, ...rawInput } = issueInput;
        const input = yield* Schema.decodeUnknownEffect(
          manualInvoiceInputSchema,
          { onExcessProperty: "error" }
        )(rawInput).pipe(
          Effect.mapError(
            () =>
              new ManualInvoiceValidationError({
                message: "Manual invoice input is invalid.",
              })
          )
        );
        const normalized = yield* normalizeManualInvoiceInput(input);
        const existingInvoice = yield* findById(normalized.invoiceId);
        if (existingInvoice) {
          yield* validateManualInvoiceRetry({
            invoice: existingInvoice,
            normalized,
          });
          if (!isManualInvoiceDocument(existingInvoice.document)) {
            return yield* new ManualInvoiceConflictError({
              invoiceId: normalized.invoiceId,
              message: "Invoice id is already used by a reservation invoice.",
            });
          }
          return {
            invoice: {
              ...existingInvoice,
              workspaceReservationId: null,
              paymentAttemptId: null,
              document: existingInvoice.document,
            },
            changed: false,
          };
        }
        if (!isInvoiceCurrencyPayable(normalized.currency)) {
          return yield* new ManualInvoiceValidationError({
            message:
              "No receiving account is configured for the invoice currency.",
          });
        }

        const outcome = yield* transaction(
          Effect.gen(function* () {
            yield* WorkspaceLocks.manualInvoiceIssue(normalized.invoiceId);
            const [existing] = yield* db
              .select({ id: invoices.id })
              .from(invoices)
              .where(eq(invoices.id, normalized.invoiceId))
              .limit(1);
            if (existing) return { changed: false } as const;

            const numbering = yield* allocateInvoiceNumber(
              normalized.invoiceId
            );
            const document = makeManualInvoiceDocument({
              normalized,
              invoiceNumber: numbering.invoiceNumber,
              issuedAt: numbering.issuedAt,
            });
            yield* insertEncryptedInvoice({
              invoiceId: normalized.invoiceId,
              source: {
                id: normalized.invoiceId,
                workspaceReservationId: null,
                paymentAttemptId: null,
                dotyposCustomerId: normalized.dotyposCustomerId,
              },
              numbering,
              document,
            });
            yield* db.insert(manualInvoiceActors).values({
              invoiceId: normalized.invoiceId,
              actorAccountId: issuedBy.accountId,
              actorAccountEmail: issuedBy.email,
            });
            return { changed: true } as const;
          })
        );

        const invoice = yield* findById(normalized.invoiceId);
        if (!invoice) {
          return yield* new InvoiceStorageError({
            operation: "load",
            paymentAttemptId: normalized.invoiceId,
            message: "Issued invoice could not be loaded.",
          });
        }
        yield* validateManualInvoiceRetry({ invoice, normalized });
        if (!isManualInvoiceDocument(invoice.document)) {
          return yield* new ManualInvoiceConflictError({
            invoiceId: normalized.invoiceId,
            message: "Invoice id is already used by a reservation invoice.",
          });
        }
        return {
          invoice: {
            ...invoice,
            workspaceReservationId: null,
            paymentAttemptId: null,
            document: invoice.document,
          },
          changed: outcome.changed,
        };
      });

      const getSuggestedVariableSymbol = Effect.fn(
        "InvoiceRepository.getSuggestedVariableSymbol"
      )(function* () {
        const issuedAt = Temporal.Now.instant();
        const numberingYear = getInvoiceNumberingYear(issuedAt);
        const [counter] = yield* db
          .select({ sequence: invoiceNumberCounters.lastSequence })
          .from(invoiceNumberCounters)
          .where(eq(invoiceNumberCounters.numberingYear, numberingYear))
          .limit(1);
        return getInvoiceVariableSymbol(
          formatInvoiceNumber({
            year: numberingYear,
            sequence: (counter?.sequence ?? 0) + 1,
          })
        );
      });

      return {
        ...reads,
        issue,
        issueManual,
        getSuggestedVariableSymbol,
      } satisfies IInvoiceRepository;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.merge(
        invoiceStorage,
        AccountingDocumentSnapshotRepository.Default.pipe(
          Layer.provide(invoiceStorage)
        )
      )
    )
  );
}

const isActivePaidAttempt = <
  Locked extends {
    readonly paymentAttemptState: string;
    readonly reservationPaymentState: string;
    readonly activePaymentAttemptId: string | null;
    readonly paidAt: Temporal.Instant | null;
  },
>(
  locked: Locked,
  paymentAttemptId: string
): locked is Locked & { readonly paidAt: Temporal.Instant } =>
  locked.paymentAttemptState === "paid" &&
  locked.reservationPaymentState === "paid" &&
  locked.activePaymentAttemptId === paymentAttemptId &&
  locked.paidAt !== null;

/** Issuance waits for a cancellation in progress and never follows one. */
const isCancellingReservation = (locked: {
  readonly reservationState: string;
}) =>
  locked.reservationState === "cancelling" ||
  locked.reservationState === "cancelled";

const snapshotMatchesLockedReservation = (
  source: {
    readonly workspaceReservationId: string;
    readonly dotyposCustomerId: string;
    readonly dotyposReservationId: string;
  },
  locked: {
    readonly reservationId: string;
    readonly dotyposCustomerId: string;
    readonly dotyposReservationId: string | null;
  }
) =>
  source.workspaceReservationId === locked.reservationId &&
  source.dotyposCustomerId === locked.dotyposCustomerId &&
  source.dotyposReservationId === locked.dotyposReservationId;

const wrapInvoiceEligibilityError = (
  paymentAttemptId: string,
  message: string
) => new InvoiceEligibilityError({ paymentAttemptId, message });

const validateManualInvoiceRetry = Effect.fn(
  "InvoiceRepository.validateManualInvoiceRetry"
)(function* (input: {
  readonly invoice: Invoice;
  readonly normalized: NormalizedManualInvoiceInput;
}) {
  if (!isManualInvoiceDocument(input.invoice.document)) {
    return yield* new ManualInvoiceConflictError({
      invoiceId: input.normalized.invoiceId,
      message: "Invoice id is already used by a reservation invoice.",
    });
  }
  const expected = makeManualInvoiceDocument({
    normalized: input.normalized,
    invoiceNumber: input.invoice.invoiceNumber,
    issuedAt: input.invoice.issuedAt,
  });
  if (JSON.stringify(expected) !== JSON.stringify(input.invoice.document)) {
    return yield* new ManualInvoiceConflictError({
      invoiceId: input.normalized.invoiceId,
      message: "Invoice id was already used with different input.",
    });
  }
});
