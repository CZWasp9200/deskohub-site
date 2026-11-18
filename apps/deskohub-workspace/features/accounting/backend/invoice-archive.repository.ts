import "@/shared/polyfills/temporal";

import { eq, inArray } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceArchives, invoiceCancellations, invoices } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import {
  type InvoiceArchive,
  InvoiceArchiveError,
} from "@/features/accounting/invoice-archive";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";

interface InvoiceArchiving {
  readonly archive: InvoiceArchive;
  /** False when the invoice was already archived; nothing was recorded. */
  readonly changed: boolean;
}

export interface IInvoiceArchiveRepository {
  /**
   * Archives the cancelled invoice once, recording the actor. Archiving an
   * archived invoice records nothing and returns the existing archive. The
   * database refuses archiving an invoice without a cancellation.
   */
  readonly archive: (input: {
    readonly invoiceId: InvoiceId;
    readonly actor: AdministrationActor;
  }) => Effect.Effect<
    InvoiceArchiving,
    InvoiceArchiveError | DatabaseQueryError
  >;
  readonly find: (
    invoiceId: InvoiceId
  ) => Effect.Effect<InvoiceArchive | null, EffectDrizzleQueryError>;
  /** The archives among the requested invoices; unarchived ones are absent. */
  readonly findMany: (
    invoiceIds: readonly InvoiceId[]
  ) => Effect.Effect<
    ReadonlyMap<InvoiceId, InvoiceArchive>,
    EffectDrizzleQueryError
  >;
}

export class InvoiceArchiveRepository extends Context.Service<
  InvoiceArchiveRepository,
  IInvoiceArchiveRepository
>()("@deskohub-workspace/accounting/InvoiceArchiveRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findMany = Effect.fn("InvoiceArchiveRepository.findMany")(
        function* (invoiceIds: readonly InvoiceId[]) {
          const rows =
            invoiceIds.length === 0
              ? []
              : yield* db
                  .select()
                  .from(invoiceArchives)
                  .where(inArray(invoiceArchives.invoiceId, invoiceIds));
          return new Map(
            rows.map((row): [InvoiceId, InvoiceArchive] => [
              row.invoiceId,
              {
                invoiceId: row.invoiceId,
                archivedAt: row.archivedAt,
                source: row.source,
                actor: {
                  accountId: row.actorAccountId,
                  email: row.actorAccountEmail,
                },
              },
            ])
          );
        }
      );

      const find = Effect.fn("InvoiceArchiveRepository.find")(function* (
        invoiceId: InvoiceId
      ) {
        return (yield* findMany([invoiceId])).get(invoiceId) ?? null;
      });

      const archive = Effect.fn("InvoiceArchiveRepository.archive")(function* (
        input: Parameters<IInvoiceArchiveRepository["archive"]>[0]
      ) {
        // A cancellation is never undone, so it can't disappear between this
        // read and the insert; the foreign key still has the last word.
        const [standing] = yield* db
          .select({ cancelledAt: invoiceCancellations.cancelledAt })
          .from(invoices)
          .leftJoin(
            invoiceCancellations,
            eq(invoiceCancellations.invoiceId, invoices.id)
          )
          .where(eq(invoices.id, input.invoiceId))
          .limit(1);
        if (!standing) {
          return yield* new InvoiceArchiveError({
            code: "not_found",
            invoiceId: input.invoiceId,
            message: "The invoice does not exist.",
          });
        }
        if (standing.cancelledAt === null) {
          return yield* new InvoiceArchiveError({
            code: "not_cancelled",
            invoiceId: input.invoiceId,
            message: "Only a cancelled invoice can be archived.",
          });
        }

        const [inserted] = yield* db
          .insert(invoiceArchives)
          .values({
            invoiceId: input.invoiceId,
            archivedAt: Temporal.Now.instant(),
            actorAccountId: input.actor.administrator.accountId,
            actorAccountEmail: input.actor.administrator.email,
            source: input.actor.source,
          })
          .onConflictDoNothing({ target: invoiceArchives.invoiceId })
          .returning({ invoiceId: invoiceArchives.invoiceId });
        const stored = yield* find(input.invoiceId);
        if (!stored) {
          return yield* Effect.die(
            new Error("An invoice archive disappeared after it was recorded.")
          );
        }
        return {
          archive: stored,
          changed: inserted !== undefined,
        } satisfies InvoiceArchiving;
      });

      return { archive, find, findMany } satisfies IInvoiceArchiveRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
