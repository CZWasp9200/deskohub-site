import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import { findSqlState } from "@/db/sql-constraint";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type {
  AccountingSnapshotKey,
  IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";
import { makeInvoiceCancellationTestKit } from "./invoice-cancellation.test-utils";

// Listing reads every invoice in the table, and this suite leaves one that
// cannot be opened, so it owns its database.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "invoice_unreadable_listing"
);
afterAll(() => testDatabase?.close());
// The kit only touches the database when a test calls it.
const { cancel, issueManualInvoice, makeActor, run } =
  makeInvoiceCancellationTestKit(testDatabase!);

const readableKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K209901"),
  secret: "synthetic readable listing secret!",
};
// Seals an invoice under a key id this deployment knows by another secret,
// as a preview reads the invoices it inherited from production.
const foreignKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K209902"),
  secret: "synthetic foreign deployment secret!",
};

const sealingWith = (
  active: AccountingSnapshotKey
): IAccountingSnapshotKeyService => ({
  getActive: Effect.succeed(active),
  getById: (keyId) =>
    Effect.succeed(keyId === foreignKey.id ? foreignKey : readableKey),
});

const readingKeys: IAccountingSnapshotKeyService = {
  getActive: Effect.succeed(readableKey),
  getById: (keyId) =>
    Effect.succeed(
      keyId === foreignKey.id
        ? { ...foreignKey, secret: "synthetic local deployment secret!" }
        : readableKey
    ),
};

describe.skipIf(!testDatabase)("listing invoices that cannot be opened", () => {
  test("lists an unreadable invoice from its unencrypted columns while the strict listing still fails", async () => {
    const actor = await makeActor("unreadable-listing");
    const readable = await issueManualInvoice(actor, sealingWith(readableKey));
    const foreign = await issueManualInvoice(actor, sealingWith(foreignKey));
    await run(
      cancel({ invoiceId: foreign.id, actor }),
      sealingWith(foreignKey)
    );

    const listed = await run(
      Effect.flatMap(InvoiceRepository, (invoices) =>
        invoices.listWithUnreadable()
      ),
      readingKeys
    );
    const strict = await run(
      Effect.flatMap(InvoiceRepository, (invoices) =>
        Effect.flip(invoices.list())
      ),
      readingKeys
    );

    expect(listed.readable.map(({ id }) => id)).toEqual([readable.id]);
    expect(listed.unreadable).toEqual([
      {
        id: foreign.id,
        invoiceNumber: foreign.invoiceNumber,
        issuedAt: foreign.issuedAt,
        cancellation: {
          cancelledAt: expect.anything(),
          cause: "invoice_cancellation",
          correctiveDocumentNumber: expect.any(String),
        },
        archivedAt: null,
        replacesInvoiceId: null,
        replacedByInvoiceId: null,
      },
    ]);
    expect(strict).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "decrypt",
      reference: { type: "invoiceId", id: foreign.id },
    });
  });

  test("fails the listing when the decrypting statement fails for a reason other than the document", async () => {
    const actor = await makeActor("unreadable-listing-outage");
    await issueManualInvoice(actor, sealingWith(readableKey));
    // Only the decrypting statement reads this column: the key lookup before
    // it and the standing a degraded row is read from still succeed.
    const renameCustomerColumn = (from: string, to: string) =>
      testDatabase!.pool.query(
        `alter table invoices rename column ${from} to ${to}`
      );
    await renameCustomerColumn("dotypos_customer_id", "dotypos_customer_gone");
    const listed = await run(
      Effect.flatMap(InvoiceRepository, (invoices) =>
        Effect.exit(invoices.listWithUnreadable())
      ),
      readingKeys
    ).finally(() =>
      renameCustomerColumn("dotypos_customer_gone", "dotypos_customer_id")
    );

    expect(Exit.isFailure(listed)).toBe(true);
    const error = Exit.isFailure(listed)
      ? Exit.findErrorOption(listed).pipe(Option.getOrUndefined)
      : undefined;
    expect(error).toMatchObject({ _tag: "EffectDrizzleQueryError" });
    expect(
      error?._tag === "EffectDrizzleQueryError" && findSqlState(error)
    ).toEqual(Option.some("42703"));
    // The decrypting statement binds the key: the error keeps it censored.
    const reported = `${error?.message} ${JSON.stringify(error)}`;
    expect(reported).not.toContain(readableKey.secret);
    expect(reported).not.toContain("synthetic local deployment secret!");
  });
});
