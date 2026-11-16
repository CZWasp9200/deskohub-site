import "@/shared/polyfills/temporal";

import type { EmailDeliveryId } from "@deskohub/email";
import { and, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import {
  correctiveDocumentNumberCounters,
  correctiveDocuments,
  invoiceCancellationNoticeDeliveries,
  invoiceCancellations,
  invoiceEmailDeliveries,
  invoiceEmailDeliveryAudiences,
  invoices,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import {
  type CorrectiveDocument,
  correctiveDocumentSchema,
  decodeCorrectiveDocument,
  formatCorrectiveDocumentNumber,
  makeCorrectiveDocument,
} from "@/features/accounting/corrective-document";
import {
  type InvoiceCancellationCause,
  InvoiceCancellationError,
  type InvoiceCancellationRecord,
  type InvoiceNoticeStatus,
  type InvoiceNoticeSummary,
} from "@/features/accounting/invoice-cancellation";
import type {
  InvoiceEmailDeliveryAudience,
  InvoiceEmailDeliveryFailureCode,
} from "@/features/accounting/invoice-email-delivery";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { isStaleDeliveryClaim } from "./delivery-claim-lease";
import { allocateAnnualNumber } from "./document-numbering";
import { makeInvoiceReads } from "./invoice-reads";
import { sealedAccountingJson } from "./sealed-accounting-json";

/** Corrective documents, sealed beside their numbering. */
const sealedCorrectiveDocuments = sealedAccountingJson({
  label: "Corrective document",
  table: correctiveDocuments,
  keyId: correctiveDocuments.keyId,
  ciphertext: correctiveDocuments.encryptedDocument,
  plaintext: { cancelledInvoiceId: correctiveDocuments.cancelledInvoiceId },
  encode: (document: CorrectiveDocument) => document,
  schema: correctiveDocumentSchema,
});

/** A cancellation notice this worker may send: its audience and attempt. */
export interface InvoiceNoticeClaim {
  readonly audience: InvoiceEmailDeliveryAudience;
  readonly attemptNumber: number;
}

export interface InvoiceCancellationRecording {
  /** False when the invoice was already cancelled; nothing was recorded. */
  readonly changed: boolean;
  readonly record: InvoiceCancellationRecord;
  /** The notices this recording claimed for sending; empty when unchanged. */
  readonly claims: readonly InvoiceNoticeClaim[];
}

export interface IInvoiceCancellationRepository {
  /**
   * Cancels the invoice once, inside the caller's transaction: it locks the
   * invoice row, issues the corrective document under the next `WS-OD`
   * number, and claims the notices owed (the customer's when the invoice
   * email was ever accepted for them, the internal copy always). Cancelling a
   * cancelled invoice records nothing and returns the existing cancellation.
   * It fails `confirmation_stale` when a customer notice is owed or the
   * customer's invoice email is still in flight and the caller didn't confirm
   * the notice. The caller locks and checks a reservation first.
   */
  readonly record: (input: {
    readonly invoiceId: InvoiceId;
    readonly cause: InvoiceCancellationCause;
    readonly actor: AdministrationActor;
    readonly confirmedCustomerNotice: boolean;
  }) => Effect.Effect<
    InvoiceCancellationRecording,
    InvoiceCancellationError | DatabaseQueryError,
    WorkspaceTransaction
  >;
  readonly find: (
    invoiceId: InvoiceId
  ) => Effect.Effect<InvoiceCancellationRecord | null, EffectDrizzleQueryError>;
  /** The cancellations among the requested invoices; live ones are absent. */
  readonly findMany: (
    invoiceIds: readonly InvoiceId[]
  ) => Effect.Effect<
    ReadonlyMap<InvoiceId, InvoiceCancellationRecord>,
    EffectDrizzleQueryError
  >;
  /**
   * Decrypts the corrective document; `null` for a live invoice. A document
   * that can't be read fails `document_unavailable`; a failing database
   * fails as itself.
   */
  readonly loadCorrectiveDocument: (
    invoiceId: InvoiceId
  ) => Effect.Effect<
    CorrectiveDocument | null,
    InvoiceCancellationError | EffectDrizzleQueryError
  >;
  /**
   * Claims the audience's notice of a cancelled invoice: a first claim when
   * none exists, or another attempt after a failure or an expired lease.
   * `null` when it was accepted, another worker holds it, the invoice isn't
   * cancelled, or it isn't owed: a customer notice is first claimed only once
   * the customer's invoice email was accepted, as when that acceptance lands
   * after the cancellation. It waits for a cancellation being recorded.
   */
  readonly claimNotice: (input: {
    readonly invoiceId: InvoiceId;
    readonly audience: InvoiceEmailDeliveryAudience;
  }) => Effect.Effect<InvoiceNoticeClaim | null, DatabaseQueryError>;
  readonly markNoticeAccepted: (input: {
    readonly invoiceId: InvoiceId;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly attemptNumber: number;
    readonly providerDeliveryId: EmailDeliveryId;
    readonly acceptedAt: Temporal.Instant;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly markNoticeFailed: (input: {
    readonly invoiceId: InvoiceId;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly attemptNumber: number;
    readonly failureCode: InvoiceEmailDeliveryFailureCode;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export class InvoiceCancellationRepository extends Context.Service<
  InvoiceCancellationRepository,
  IInvoiceCancellationRepository
>()("@deskohub-workspace/accounting/InvoiceCancellationRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const sealedDocuments = yield* sealedCorrectiveDocuments;
      const reads = yield* makeInvoiceReads;

      const findMany = Effect.fn("InvoiceCancellationRepository.findMany")(
        function* (invoiceIds: readonly InvoiceId[]) {
          const rows =
            invoiceIds.length === 0
              ? []
              : yield* db
                  .select({
                    invoiceId: invoiceCancellations.invoiceId,
                    cancelledAt: invoiceCancellations.cancelledAt,
                    cause: invoiceCancellations.cause,
                    source: invoiceCancellations.source,
                    actorAccountId: invoiceCancellations.actorAccountId,
                    actorAccountEmail: invoiceCancellations.actorAccountEmail,
                    correctiveDocumentNumber:
                      correctiveDocuments.documentNumber,
                    correctiveDocumentIssuedAt: correctiveDocuments.issuedAt,
                  })
                  .from(invoiceCancellations)
                  .innerJoin(
                    correctiveDocuments,
                    eq(
                      correctiveDocuments.cancelledInvoiceId,
                      invoiceCancellations.invoiceId
                    )
                  )
                  .where(inArray(invoiceCancellations.invoiceId, invoiceIds));
          const notices =
            rows.length === 0
              ? []
              : yield* db
                  .select({
                    invoiceId: invoiceCancellationNoticeDeliveries.invoiceId,
                    audience: invoiceCancellationNoticeDeliveries.audience,
                    state: invoiceCancellationNoticeDeliveries.state,
                    stale: sql<boolean>`${isStaleNotice()}`,
                  })
                  .from(invoiceCancellationNoticeDeliveries)
                  .where(
                    inArray(
                      invoiceCancellationNoticeDeliveries.invoiceId,
                      rows.map(({ invoiceId }) => invoiceId)
                    )
                  );
          const sentToCustomer =
            rows.length === 0
              ? []
              : yield* db
                  .select({ invoiceId: invoiceEmailDeliveries.invoiceId })
                  .from(invoiceEmailDeliveries)
                  .where(
                    and(
                      inArray(
                        invoiceEmailDeliveries.invoiceId,
                        rows.map(({ invoiceId }) => invoiceId)
                      ),
                      eq(invoiceEmailDeliveries.audience, "customer"),
                      isNotNull(invoiceEmailDeliveries.acceptedAt)
                    )
                  );
          const customerNoticeOwed = new Set(
            sentToCustomer.map(({ invoiceId }) => invoiceId)
          );
          const noticesByInvoice = Map.groupBy(
            notices,
            ({ invoiceId }) => invoiceId
          );
          return new Map(
            rows.map((row): [InvoiceId, InvoiceCancellationRecord] => [
              row.invoiceId,
              {
                invoiceId: row.invoiceId,
                cancelledAt: row.cancelledAt,
                cause: row.cause,
                correctiveDocumentNumber: row.correctiveDocumentNumber,
                correctiveDocumentIssuedAt: row.correctiveDocumentIssuedAt,
                source: row.source,
                actor: {
                  accountId: row.actorAccountId,
                  email: row.actorAccountEmail,
                },
                notices: summarizeNotices(
                  noticesByInvoice.get(row.invoiceId) ?? [],
                  customerNoticeOwed.has(row.invoiceId)
                ),
              },
            ])
          );
        }
      );

      const find = Effect.fn("InvoiceCancellationRepository.find")(function* (
        invoiceId: InvoiceId
      ) {
        return (yield* findMany([invoiceId])).get(invoiceId) ?? null;
      });

      const cancellationError = (
        invoiceId: InvoiceId,
        code: InvoiceCancellationError["code"],
        message: string,
        cause?: unknown
      ) =>
        new InvoiceCancellationError({
          code,
          invoiceId,
          message,
          cause: cause === undefined ? undefined : censorLogValue(cause),
        });

      const record = Effect.fn("InvoiceCancellationRepository.record")(
        function* (
          input: Parameters<IInvoiceCancellationRepository["record"]>[0]
        ) {
          const { db } = yield* WorkspaceTransaction;
          const { invoiceId } = input;

          // A row lock fires no update trigger. NO KEY UPDATE serializes
          // cancellations without blocking delivery-ledger foreign keys.
          const [locked] = yield* db
            .select({ id: invoices.id })
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .limit(1)
            .for("no key update");
          if (!locked) {
            return yield* cancellationError(
              invoiceId,
              "not_found",
              "The invoice does not exist."
            );
          }

          const existing = yield* find(invoiceId);
          if (existing) {
            return {
              changed: false,
              record: existing,
              claims: [],
            } satisfies InvoiceCancellationRecording;
          }

          // A failing database leaves as its own error, like every other
          // statement here.
          const invoice = yield* reads
            .findById(invoiceId)
            .pipe(
              Effect.catchTag("AccountingRecordUnavailable", (cause) =>
                Effect.fail(
                  cancellationError(
                    invoiceId,
                    "document_unavailable",
                    "The invoice document could not be read.",
                    cause
                  )
                )
              )
            );
          if (!invoice) {
            return yield* cancellationError(
              invoiceId,
              "document_unavailable",
              "The invoice disappeared while cancelling."
            );
          }

          const [customerDelivery] = yield* db
            .select({
              state: invoiceEmailDeliveries.state,
              acceptedAt: invoiceEmailDeliveries.acceptedAt,
            })
            .from(invoiceEmailDeliveries)
            .where(
              and(
                eq(invoiceEmailDeliveries.invoiceId, invoiceId),
                eq(invoiceEmailDeliveries.audience, "customer")
              )
            )
            .limit(1);
          const sentToCustomer = customerDelivery?.acceptedAt != null;
          const customerEmailInFlight =
            customerDelivery?.state === "processing";
          if (
            (sentToCustomer || customerEmailInFlight) &&
            !input.confirmedCustomerNotice
          ) {
            return yield* cancellationError(
              invoiceId,
              "confirmation_stale",
              "The invoice was sent to the customer since the cancellation was confirmed."
            );
          }

          const reference = { type: "invoiceId", id: invoiceId } as const;
          const sealer = yield* sealedDocuments
            .sealer(reference)
            .pipe(
              Effect.mapError((cause) =>
                cancellationError(
                  invoiceId,
                  "persistence_failed",
                  "The corrective document encryption key is unavailable.",
                  cause
                )
              )
            );
          const allocated = yield* allocateAnnualNumber(
            correctiveDocumentNumberCounters
          ).pipe(
            Effect.catchTag("DocumentNumberAllocationError", ({ message }) =>
              Effect.fail(
                cancellationError(invoiceId, "persistence_failed", message)
              )
            )
          );
          const documentNumber = formatCorrectiveDocumentNumber({
            year: allocated.numberingYear,
            sequence: allocated.numberingSequence,
          });
          const document = yield* decodeCorrectiveDocument(
            makeCorrectiveDocument({
              invoice,
              cause: input.cause,
              actor: input.actor,
              documentNumber,
              issuedAt: allocated.issuedAt,
            })
          ).pipe(
            Effect.mapError(() =>
              cancellationError(
                invoiceId,
                "document_unavailable",
                "The corrective document schema is invalid."
              )
            )
          );

          yield* db.insert(invoiceCancellations).values({
            invoiceId,
            cancelledAt: allocated.issuedAt,
            cause: input.cause,
            actorAccountId: input.actor.administrator.accountId,
            actorAccountEmail: input.actor.administrator.email,
            source: input.actor.source,
          });
          yield* sealer
            .seal({
              reference,
              value: document,
              insert: (sealed) =>
                db.insert(correctiveDocuments).values({
                  cancelledInvoiceId: invoiceId,
                  documentNumber,
                  numberingYear: allocated.numberingYear,
                  numberingSequence: allocated.numberingSequence,
                  keyId: sealed.keyId,
                  encryptedDocument: sealed.ciphertext,
                  issuedAt: allocated.issuedAt,
                }),
            })
            .pipe(
              Effect.mapError((cause) =>
                cancellationError(
                  invoiceId,
                  "persistence_failed",
                  "The corrective document could not be encrypted.",
                  cause
                )
              )
            );

          const owedAudiences = invoiceEmailDeliveryAudiences.filter(
            (audience) => audience === "internal" || sentToCustomer
          );
          const claims = yield* db
            .insert(invoiceCancellationNoticeDeliveries)
            .values(
              owedAudiences.map((audience) => ({
                invoiceId,
                audience,
                state: "processing" as const,
                attemptCount: 1,
                updatedAt: allocated.issuedAt,
              }))
            )
            .returning({
              audience: invoiceCancellationNoticeDeliveries.audience,
              attemptNumber: invoiceCancellationNoticeDeliveries.attemptCount,
            });

          const recorded = yield* find(invoiceId);
          if (!recorded) {
            return yield* Effect.die(
              new Error(
                "An invoice cancellation disappeared after it was recorded."
              )
            );
          }
          return {
            changed: true,
            record: recorded,
            claims,
          } satisfies InvoiceCancellationRecording;
        }
      );

      const loadCorrectiveDocument = Effect.fn(
        "InvoiceCancellationRepository.loadCorrectiveDocument"
      )(function* (invoiceId: InvoiceId) {
        const opened = yield* sealedDocuments
          .open({
            reference: { type: "invoiceId", id: invoiceId },
            where: eq(correctiveDocuments.cancelledInvoiceId, invoiceId),
          })
          .pipe(
            Effect.catchTag("AccountingRecordUnavailable", (cause) =>
              Effect.fail(
                cancellationError(
                  invoiceId,
                  "document_unavailable",
                  "The corrective document could not be read.",
                  cause
                )
              )
            )
          );
        return opened?.value ?? null;
      });

      const isCustomerNoticeOwed = Effect.fnUntraced(function* (
        invoiceId: InvoiceId
      ) {
        const [owed] = yield* db
          .select({ id: invoiceCancellationNoticeDeliveries.id })
          .from(invoiceCancellationNoticeDeliveries)
          .where(
            and(
              eq(invoiceCancellationNoticeDeliveries.invoiceId, invoiceId),
              eq(invoiceCancellationNoticeDeliveries.audience, "customer")
            )
          )
          .limit(1);
        if (owed) return true;
        const [delivery] = yield* db
          .select({ acceptedAt: invoiceEmailDeliveries.acceptedAt })
          .from(invoiceEmailDeliveries)
          .where(
            and(
              eq(invoiceEmailDeliveries.invoiceId, invoiceId),
              eq(invoiceEmailDeliveries.audience, "customer")
            )
          )
          .limit(1);
        return delivery?.acceptedAt != null;
      });

      const insertNoticeClaim = Effect.fnUntraced(function* ({
        invoiceId,
        audience,
      }: Parameters<IInvoiceCancellationRepository["claimNotice"]>[0]) {
        const now = Temporal.Now.instant();
        const [claimed] = yield* db
          .insert(invoiceCancellationNoticeDeliveries)
          .values({
            invoiceId,
            audience,
            state: "processing",
            attemptCount: 1,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              invoiceCancellationNoticeDeliveries.invoiceId,
              invoiceCancellationNoticeDeliveries.audience,
            ],
            set: {
              state: "processing",
              attemptCount: sql`${invoiceCancellationNoticeDeliveries.attemptCount} + 1`,
              providerDeliveryId: null,
              failureCode: null,
              updatedAt: now,
            },
            setWhere: or(
              eq(invoiceCancellationNoticeDeliveries.state, "failed"),
              isStaleNotice()
            ),
          })
          .returning({
            audience: invoiceCancellationNoticeDeliveries.audience,
            attemptNumber: invoiceCancellationNoticeDeliveries.attemptCount,
          });
        return claimed ?? null;
      });

      const claimNotice = Effect.fn(
        "InvoiceCancellationRepository.claimNotice"
      )(function* ({
        invoiceId,
        audience,
      }: Parameters<IInvoiceCancellationRepository["claimNotice"]>[0]) {
        return yield* transaction(
          Effect.gen(function* () {
            // The share lock waits for a cancellation recording on the
            // invoice row, so a late acceptance never misses it.
            const [invoice] = yield* db
              .select({ id: invoices.id })
              .from(invoices)
              .where(eq(invoices.id, invoiceId))
              .limit(1)
              .for("share");
            if (!invoice) return null;
            const [cancellation] = yield* db
              .select({ invoiceId: invoiceCancellations.invoiceId })
              .from(invoiceCancellations)
              .where(eq(invoiceCancellations.invoiceId, invoiceId))
              .limit(1);
            if (!cancellation) return null;
            // The customer is owed a notice only once their invoice email
            // was accepted; an owed notice is retried whatever happens later.
            if (
              audience === "customer" &&
              !(yield* isCustomerNoticeOwed(invoiceId))
            ) {
              return null;
            }
            return yield* insertNoticeClaim({ invoiceId, audience });
          })
        );
      });

      const matchesClaim = (input: {
        readonly invoiceId: InvoiceId;
        readonly audience: InvoiceEmailDeliveryAudience;
        readonly attemptNumber: number;
      }) =>
        and(
          eq(invoiceCancellationNoticeDeliveries.invoiceId, input.invoiceId),
          eq(invoiceCancellationNoticeDeliveries.audience, input.audience),
          eq(invoiceCancellationNoticeDeliveries.state, "processing"),
          eq(
            invoiceCancellationNoticeDeliveries.attemptCount,
            input.attemptNumber
          )
        );

      return {
        record,
        find,
        findMany,
        loadCorrectiveDocument,
        claimNotice,
        markNoticeAccepted: Effect.fn(
          "InvoiceCancellationRepository.markNoticeAccepted"
        )(function* (input) {
          yield* db
            .update(invoiceCancellationNoticeDeliveries)
            .set({
              state: "accepted",
              providerDeliveryId: input.providerDeliveryId,
              failureCode: null,
              acceptedAt: input.acceptedAt,
              updatedAt: input.acceptedAt,
            })
            .where(matchesClaim(input));
        }),
        markNoticeFailed: Effect.fn(
          "InvoiceCancellationRepository.markNoticeFailed"
        )(function* (input) {
          yield* db
            .update(invoiceCancellationNoticeDeliveries)
            .set({
              state: "failed",
              failureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(matchesClaim(input));
        }),
      } satisfies IInvoiceCancellationRepository;
    })
  );
}

/** Matches a processing notice whose claim outlived its lease. */
const isStaleNotice = (): SQL =>
  isStaleDeliveryClaim(invoiceCancellationNoticeDeliveries);

/**
 * The notice state per audience. A customer notice owed (the customer's
 * invoice email was accepted) but never claimed reads as failed, so it is
 * retried rather than reported as not owed.
 */
const summarizeNotices = (
  notices: readonly {
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly state: InvoiceNoticeStatus;
    readonly stale: boolean;
  }[],
  customerNoticeOwed: boolean
): InvoiceNoticeSummary => {
  const statusOf = (audience: InvoiceEmailDeliveryAudience) =>
    notices.find((notice) => notice.audience === audience)?.state;
  const customer =
    statusOf("customer") ?? (customerNoticeOwed ? "failed" : "not_owed");
  const internal = statusOf("internal") ?? "not_owed";
  return {
    customer,
    internal,
    needsAttention:
      customer === "failed" ||
      notices.some(({ stale, state }) => stale || state === "failed"),
  };
};
