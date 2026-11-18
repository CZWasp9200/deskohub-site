import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceArchiveRepository } from "./invoice-archive.repository";
import { makeInvoiceCancellationTestKit } from "./invoice-cancellation.test-utils";

// Cancellations pin their invoices, which suites sharing the configured
// database delete, so the suite owns its database.
const testDatabase =
  await createWorkspacePostgresSuiteDatabase("invoice_archive");
afterAll(() => testDatabase?.close());
// The kit only touches the database when a test calls it.
const { cancel, issueManualInvoice, makeActor, query, run } =
  makeInvoiceCancellationTestKit(testDatabase!);

describe.skipIf(!testDatabase)(
  "InvoiceArchiveRepository on disposable Postgres",
  () => {
    test("archives a cancelled invoice once and records who archived it", async () => {
      const actor = await makeActor("archive-once");
      const other = await makeActor("archive-replay");
      const invoice = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: invoice.id, actor }));

      const first = await run(
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.archive({ invoiceId: invoice.id, actor })
        )
      );
      const replay = await run(
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.archive({ invoiceId: invoice.id, actor: other })
        )
      );

      expect(first).toMatchObject({
        changed: true,
        archive: {
          invoiceId: invoice.id,
          source: "dhw-cli",
          actor: {
            accountId: actor.administrator.accountId,
            email: actor.administrator.email,
          },
        },
      });
      expect(replay).toEqual({ changed: false, archive: first.archive });
      const reread = await run(
        Effect.flatMap(InvoiceRepository, (invoices) =>
          invoices.findById(invoice.id)
        )
      );
      expect(reread?.archivedAt).toEqual(first.archive.archivedAt);
    });

    test("refuses to archive a live invoice, and the database refuses it too", async () => {
      const actor = await makeActor("archive-live");
      const invoice = await issueManualInvoice(actor);

      const refused = await run(
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.archive({ invoiceId: invoice.id, actor })
        ).pipe(Effect.flip)
      );
      expect(refused).toMatchObject({
        _tag: "InvoiceArchiveError",
        code: "not_cancelled",
        invoiceId: invoice.id,
      });

      const failure = await testDatabase!.pool
        .query(
          `insert into invoice_archives
             (invoice_id, archived_at, actor_account_email, source)
           values ($1, now(), 'synthetic administrator', 'admin-ui')`,
          [invoice.id]
        )
        .then(
          () => null,
          (error: { readonly code?: string }) => error.code
        );
      expect(failure).toBe("23503");
      expect(
        await query(
          "select invoice_id from invoice_archives where invoice_id = $1",
          [invoice.id]
        )
      ).toEqual([]);
    });

    test("keeps the actor's email but detaches the deleted account", async () => {
      const actor = await makeActor("archive-actor-deleted");
      const invoice = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: invoice.id, actor }));
      await run(
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.archive({ invoiceId: invoice.id, actor })
        )
      );

      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        actor.administrator.accountId,
      ]);

      const archive = await run(
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.find(invoice.id)
        )
      );
      expect(archive?.actor).toEqual({
        accountId: null,
        email: actor.administrator.email,
      });
    });
  }
);
