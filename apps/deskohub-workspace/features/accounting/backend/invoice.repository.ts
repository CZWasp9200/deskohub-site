import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
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
import type { ReadLimitExceededError } from "@/shared/backend/read-limit";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { isFulfilledReservation } from "./invoice-eligibility";
import { makeInvoiceReads, sealedInvoiceDocuments } from "./invoice-reads";
import {
  type AccountingRecordReference,
  type AccountingRecordSealer,
  AccountingRecordUnavailable,
} from "./sealed-accounting-json";

class InvoiceEligibilityError extends Data.TaggedError(
  "InvoiceEligibilityError"
)<{
  readonly paymentAttemptId: string;
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
}

/**
 * An issued invoice's numbering and source references, read without its
 * document: no decryption, no encrypted bytes and no key id.
 * `documentSnapshotRecordedAt` is when the accounting snapshot of a
 * reservation invoice's payment attempt was recorded; a manual invoice has
 * none.
 */
export interface InvoiceMetadata {
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly numberingYear: number;
  readonly numberingSequence: number;
  readonly workspaceReservationId: WorkspaceReservationId | null;
  readonly paymentAttemptId: PaymentAttemptId | null;
  readonly documentSnapshotRecordedAt: Temporal.Instant | null;
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
  | AccountingRecordUnavailable
  | EffectDrizzleQueryError
  | InvoiceEligibilityError
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
    EffectDrizzleQueryError | AccountingRecordUnavailable
  >;
  readonly findByPaymentAttemptId: (
    paymentAttemptId: string
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | AccountingRecordUnavailable
  >;
  readonly findByReservationId: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | AccountingRecordUnavailable
  >;
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
    EffectDrizzleQueryError | AccountingRecordUnavailable
  >;
  /**
   * Decrypts the Dotypos customer's invoices, newest issue first, and no
   * other customer's.
   */
  readonly listForCustomer: (
    dotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<
    readonly Invoice[],
    EffectDrizzleQueryError | AccountingRecordUnavailable
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
    EffectDrizzleQueryError | ReadLimitExceededError
  >;
  /** Decrypts every invoice. */
  readonly list: () => Effect.Effect<
    readonly Invoice[],
    EffectDrizzleQueryError | AccountingRecordUnavailable
  >;
  /** Decrypts every manual invoice to read who issued it, and through what. */
  readonly listManualInvoiceProvenance: () => Effect.Effect<
    readonly {
      readonly invoiceId: InvoiceId;
      readonly provenance: ManualInvoiceProvenance;
    }[],
    EffectDrizzleQueryError | AccountingRecordUnavailable
  >;
  readonly getSuggestedVariableSymbol: () => Effect.Effect<
    string,
    EffectDrizzleQueryError
  >;
}

interface InvoiceNumbering {
  readonly sealer: AccountingRecordSealer<InvoiceDocument>;
  readonly issuedAt: Temporal.Instant;
  readonly numberingYear: number;
  readonly numberingSequence: number;
  readonly invoiceNumber: InvoiceNumber;
}

export class InvoiceRepository extends Context.Service<
  InvoiceRepository,
  IInvoiceRepository
>()("@deskohub-workspace/accounting/InvoiceRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const accountingSnapshots = yield* AccountingDocumentSnapshots;
      const sealedDocuments = yield* sealedInvoiceDocuments;
      const reads = yield* makeInvoiceReads;
      const { findById, findByPaymentAttemptId } = reads;

      /**
       * Takes the next number of the issue year's counter, together with the
       * active key that will encrypt the invoice. Runs in the issuing
       * transaction, so a rollback returns the number.
       */
      const allocateInvoiceNumber = Effect.fnUntraced(function* (
        reference: AccountingRecordReference
      ) {
        const sealer = yield* sealedDocuments.sealer(reference);
        const issuedAt = Temporal.Instant.from(
          temporalInstantToIsoString(Temporal.Now.instant())
        );
        const numberingYear = getInvoiceNumberingYear(issuedAt);
        const [counter] = yield* db
          .insert(invoiceNumberCounters)
          .values({ numberingYear, lastSequence: 1 })
          .onConflictDoUpdate({
            target: invoiceNumberCounters.numberingYear,
            set: {
              lastSequence: sql`${invoiceNumberCounters.lastSequence} + 1`,
            },
          })
          .returning({ sequence: invoiceNumberCounters.lastSequence });

        if (!counter) {
          return yield* new AccountingRecordUnavailable({
            operation: "load",
            reference,
            message: "Invoice number allocation returned no row.",
          });
        }

        return {
          sealer,
          issuedAt,
          numberingYear,
          numberingSequence: counter.sequence,
          invoiceNumber: formatInvoiceNumber({
            year: numberingYear,
            sequence: counter.sequence,
          }),
        } satisfies InvoiceNumbering;
      });

      const insertEncryptedInvoice = (input: {
        readonly reference: AccountingRecordReference;
        readonly source: Pick<
          typeof invoices.$inferInsert,
          | "id"
          | "workspaceReservationId"
          | "paymentAttemptId"
          | "dotyposCustomerId"
        >;
        readonly numbering: InvoiceNumbering;
        readonly document: InvoiceDocument;
      }) =>
        input.numbering.sealer.seal({
          reference: input.reference,
          value: input.document,
          insert: (sealed) =>
            db.insert(invoices).values({
              ...input.source,
              invoiceNumber: input.numbering.invoiceNumber,
              numberingYear: input.numbering.numberingYear,
              numberingSequence: input.numbering.numberingSequence,
              keyId: sealed.keyId,
              encryptedDocument: sealed.ciphertext,
              issuedAt: input.numbering.issuedAt,
            }),
        });

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
        const alreadyIssued = yield* findByPaymentAttemptId(paymentAttemptId);
        if (alreadyIssued) {
          return { invoice: alreadyIssued, changed: false };
        }

        const source = yield* accountingSnapshots.find(paymentAttemptId);
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

            const [existing] = yield* db
              .select({ paymentAttemptId: invoices.paymentAttemptId })
              .from(invoices)
              .where(eq(invoices.workspaceReservationId, locked.reservationId))
              .limit(1);

            if (existing) {
              if (existing.paymentAttemptId !== paymentAttemptId) {
                return yield* wrapInvoiceEligibilityError(
                  paymentAttemptId,
                  "The reservation was invoiced from a different payment attempt."
                );
              }

              return {
                paymentAttemptId: existing.paymentAttemptId,
                changed: false,
              };
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

            const reference = {
              type: "paymentAttemptId",
              id: paymentAttemptId,
            } satisfies AccountingRecordReference;
            const numbering = yield* allocateInvoiceNumber(reference);
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
                  new AccountingRecordUnavailable({
                    operation: "validate",
                    reference,
                    message: "Invoice schema is invalid.",
                  })
              )
            );

            yield* insertEncryptedInvoice({
              reference,
              source: {
                workspaceReservationId: locked.reservationId,
                paymentAttemptId,
                dotyposCustomerId: locked.dotyposCustomerId,
              },
              numbering,
              document,
            });

            return { paymentAttemptId, changed: true };
          })
        );

        const invoice = yield* findByPaymentAttemptId(outcome.paymentAttemptId);
        if (!invoice) {
          return yield* new AccountingRecordUnavailable({
            operation: "load",
            reference: {
              type: "paymentAttemptId",
              id: outcome.paymentAttemptId,
            },
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

            const reference = {
              type: "invoiceId",
              id: normalized.invoiceId,
            } satisfies AccountingRecordReference;
            const numbering = yield* allocateInvoiceNumber(reference);
            const document = makeManualInvoiceDocument({
              normalized,
              invoiceNumber: numbering.invoiceNumber,
              issuedAt: numbering.issuedAt,
            });
            yield* insertEncryptedInvoice({
              reference,
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
          return yield* new AccountingRecordUnavailable({
            operation: "load",
            reference: { type: "invoiceId", id: normalized.invoiceId },
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
