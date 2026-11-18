import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceArchives, invoiceCancellations, invoices } from "@/db/schema";
import {
  connectWorkspacePostgresTestDatabase,
  holdDatabaseConnection,
  withHeldTransaction,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "InvoiceBreadcrumbService on disposable Postgres",
  () => {
    test("names a stored invoice by its number, and nothing for a hidden or unknown one", async () => {
      const invoiceNumber = `synthetic-breadcrumb-${crypto.randomUUID()}`;
      // Invoices are never deleted, so the row stays in a transaction that
      // rolls back.
      const connection = await holdDatabaseConnection(testDatabase!);
      try {
        await connection.query("begin");
        const labels = await Effect.runPromise(
          withHeldTransaction(connection, (db) =>
            Effect.gen(function* () {
              const insertInvoice = (number: string) =>
                db
                  .insert(invoices)
                  .values({
                    dotyposCustomerId: "synthetic-customer",
                    invoiceNumber: number,
                    numberingYear: 2026,
                    // Far beyond any sequence another suite issues.
                    numberingSequence:
                      1_000_000_000 + Math.floor(Math.random() * 1e9),
                    keyId: "SYNTHETIC_KEY",
                    encryptedDocument: Buffer.from("synthetic"),
                    issuedAt: Temporal.Instant.from("2026-06-01T12:00:00Z"),
                  } as never)
                  .returning({ id: invoices.id });
              const [stored] = yield* insertInvoice(invoiceNumber);
              const [hidden] = yield* insertInvoice(`${invoiceNumber}-hidden`);
              yield* db.insert(invoiceCancellations).values({
                invoiceId: hidden!.id,
                cancelledAt: Temporal.Instant.from("2026-06-02T12:00:00Z"),
                cause: "invoice_cancellation",
                actorAccountEmail: "synthetic administrator",
                source: "admin-ui",
              } as never);
              yield* db.insert(invoiceArchives).values({
                invoiceId: hidden!.id,
                archivedAt: Temporal.Instant.from("2026-06-03T12:00:00Z"),
                actorAccountEmail: "synthetic administrator",
                source: "admin-ui",
              } as never);
              const breadcrumb = yield* InvoiceBreadcrumbService;
              return {
                stored: yield* breadcrumb.getInvoiceNumber(
                  AdministrationInvoiceId.make(stored!.id)
                ),
                hidden: yield* breadcrumb.getInvoiceNumber(
                  AdministrationInvoiceId.make(hidden!.id)
                ),
                unknown: yield* breadcrumb.getInvoiceNumber(
                  AdministrationInvoiceId.make(crypto.randomUUID())
                ),
              };
            }).pipe(
              Effect.provide(
                InvoiceBreadcrumbService.Default.pipe(
                  Layer.provide(
                    Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db))
                  )
                )
              )
            )
          )
        );

        expect(labels).toEqual({
          stored: invoiceNumber,
          hidden: null,
          unknown: null,
        });
      } finally {
        await connection.query("rollback");
        await connection.release();
      }
    });
  }
);
