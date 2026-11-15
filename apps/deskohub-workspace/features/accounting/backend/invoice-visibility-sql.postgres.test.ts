import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { and, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoices } from "@/db/schema";
import { customerInvoiceVisibility } from "@/features/accounting/invoice-visibility";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceArchiveRepository } from "./invoice-archive.repository";
import { makeInvoiceCancellationTestKit } from "./invoice-cancellation.test-utils";
import { isVisibleToCustomer } from "./invoice-visibility-sql";

// Cancellations pin their invoices, which suites sharing the configured
// database delete, so the suite owns its database.
const testDatabase =
  await createWorkspacePostgresSuiteDatabase("invoice_visibility");
afterAll(() => testDatabase?.close());
// The kit only touches the database when a test calls it.
const { cancel, issueManualInvoice, makeActor, run } =
  makeInvoiceCancellationTestKit(testDatabase!);

describe.skipIf(!testDatabase)("invoice visibility SQL twin", () => {
  test("selects exactly the invoices the TypeScript rule lists to the customer", async () => {
    const actor = await makeActor("visibility-twin");
    const live = await issueManualInvoice(actor);
    const cancelled = await issueManualInvoice(actor);
    const archived = await issueManualInvoice(actor);
    await run(cancel({ invoiceId: cancelled.id, actor }));
    await run(cancel({ invoiceId: archived.id, actor }));
    await run(
      Effect.flatMap(InvoiceArchiveRepository, (archives) =>
        archives.archive({ invoiceId: archived.id, actor })
      )
    );
    const ids = [live.id, cancelled.id, archived.id];

    const standings = await run(
      Effect.flatMap(InvoiceRepository, (repository) =>
        Effect.forEach(ids, (id) => repository.findById(id))
      )
    );
    // The customer rule has no hidden outcome: each visibility lists it.
    const listedByRule = standings.flatMap((invoice) =>
      invoice && customerInvoiceVisibility(invoice) ? [invoice.id] : []
    );
    const listedBySql = await run(
      Effect.flatMap(WorkspaceDatabase, ({ db }) =>
        db
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(inArray(invoices.id, ids), isVisibleToCustomer()))
      )
    );

    expect(
      standings.map((invoice) => customerInvoiceVisibility(invoice!))
    ).toEqual(["listed", "listed_cancelled", "listed_cancelled"]);
    expect(new Set(listedBySql.map(({ id }) => id))).toEqual(
      new Set(listedByRule)
    );
  });
});
