import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "@/features/accounting/backend/accounting-snapshot-key.service";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { invoicePreviewIdSchema } from "./invoice-preview-id";
import { InvoicePreviews } from "./invoice-previews.service";

const testDatabase =
  await createWorkspacePostgresSuiteDatabase("invoice_previews");
afterAll(() => testDatabase?.close());

const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202611"),
  secret: "synthetic invoice preview secret!",
};

const run = <A, E>(effect: Effect.Effect<A, E, InvoicePreviews>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        InvoicePreviews.Default.pipe(
          Layer.provide(
            Layer.merge(
              testDatabase!.layer,
              Layer.succeed(
                AccountingSnapshotKeyService,
                AccountingSnapshotKeyService.of({
                  getActive: Effect.succeed(testKey),
                  getById: () => Effect.succeed(testKey),
                })
              )
            )
          )
        )
      )
    )
  );

const administrator = (label: string) =>
  Effect.runPromise(workspaceFixtures(testDatabase!.db).account(label));

const document = new TextEncoder().encode("%PDF-1.7 synthetic preview");

const keep = (
  administratorAccountId: Awaited<ReturnType<typeof administrator>>["accountId"]
) =>
  run(
    Effect.flatMap(InvoicePreviews, (previews) =>
      previews.keep({
        invoiceId: invoiceIdSchema.make(crypto.randomUUID()),
        administratorAccountId,
        document,
      })
    )
  );

const open = (
  id: string,
  administratorAccountId: Awaited<ReturnType<typeof administrator>>["accountId"]
) =>
  run(
    Effect.flatMap(InvoicePreviews, (previews) =>
      previews.open({
        id: invoicePreviewIdSchema.make(id),
        administratorAccountId,
      })
    )
  );

const query = async (text: string, values: readonly unknown[] = []) =>
  (await testDatabase!.pool.query(text, [...values])).rows;

describe.skipIf(!testDatabase)("InvoicePreviews on disposable Postgres", () => {
  test("opens a kept preview for the administrator who asked for it until it expires", async () => {
    const owner = await administrator("preview-owner");
    const kept = await keep(owner.accountId);

    const opened = await open(kept.id, owner.accountId);

    expect(Option.map(opened, ({ bytes }) => [...bytes])).toEqual(
      Option.some([...document])
    );
    const [row] = await query(
      "select extract(epoch from expires_at - created_at)::int as seconds from invoice_previews where id = $1",
      [kept.id]
    );
    expect(row?.seconds).toBe(15 * 60);
  });

  test("stores the document only as ciphertext", async () => {
    const owner = await administrator("preview-ciphertext");
    const kept = await keep(owner.accountId);

    const [row] = await query(
      "select encrypted_document from invoice_previews where id = $1",
      [kept.id]
    );
    expect(Buffer.from(row?.encrypted_document).includes("%PDF")).toBe(false);
  });

  test("opens nothing for another administrator", async () => {
    const owner = await administrator("preview-owner-only");
    const other = await administrator("preview-other");
    const kept = await keep(owner.accountId);

    expect(Option.isNone(await open(kept.id, other.accountId))).toBe(true);
  });

  test("opens nothing once expired, and deletes expired previews", async () => {
    const owner = await administrator("preview-expired");
    const expired = await keep(owner.accountId);
    await query(
      "update invoice_previews set created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes' where id = $1",
      [expired.id]
    );

    expect(Option.isNone(await open(expired.id, owner.accountId))).toBe(true);
    expect(
      await query("select id from invoice_previews where id = $1", [expired.id])
    ).toEqual([]);
  });
});
