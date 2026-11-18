import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Data, Effect, Exit, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { findSqlState, isDatabaseQueryError } from "@/db/sql-constraint";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import {
  type InvoiceId,
  invoiceIdSchema,
} from "@/features/accounting/manual-invoice";
import {
  findRenderedTexts,
  identifyingTexts,
} from "@/shared/testing/rendered-representations.test-utils";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import {
  createWorkspacePostgresSuiteDatabase,
  type WorkspacePostgresSuiteDatabase,
  withStatementTimeout,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type {
  AccountingSnapshotKey,
  IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceCancellationRepository } from "./invoice-cancellation.repository";
import {
  lockingAfterKeyLookup,
  makeInvoiceCancellationTestKit,
} from "./invoice-cancellation.test-utils";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";

// The suite counts corrective document numbers, so it owns its database.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "invoice_cancellation"
);
// The same database, whose statements time out while a table lock holds them.
const timingOutDatabase =
  testDatabase && (await withStatementTimeout(testDatabase, 300));
afterAll(async () => {
  await timingOutDatabase?.close();
  await testDatabase?.close();
});

// The kit only touches the database when a test calls it.
const {
  acceptInvoiceEmail,
  cancel,
  issueManualInvoice,
  makeActor,
  pauseBeforeActiveKey,
  query,
  run,
} = makeInvoiceCancellationTestKit(testDatabase!);
const timingOut = makeInvoiceCancellationTestKit(timingOutDatabase!);

const sealingKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K209903"),
  secret: "synthetic cancellation sealing secret!",
};
const sealingKeys: IAccountingSnapshotKeyService = {
  getActive: Effect.succeed(sealingKey),
  getById: () => Effect.succeed(sealingKey),
};
const wrongSecret = "synthetic cancellation wrong secret!";
const wrongKeys: IAccountingSnapshotKeyService = {
  getActive: Effect.succeed(sealingKey),
  getById: (keyId) => Effect.succeed({ id: keyId, secret: wrongSecret }),
};

const readCorrectiveCounters = () =>
  query<{ numbering_year: number; last_sequence: number }>(
    "select numbering_year, last_sequence from corrective_document_number_counters order by numbering_year"
  );

const readNotices = (invoiceId: InvoiceId) =>
  query<{ audience: string; state: string; attempt_count: number }>(
    `select audience, state, attempt_count
     from invoice_cancellation_notice_deliveries
     where invoice_id = $1 order by audience`,
    [invoiceId]
  );

class RolledBack extends Data.TaggedError("RolledBack")<{
  readonly reason: "test rollback";
}> {}

describe.skipIf(!testDatabase)(
  "InvoiceCancellationRepository on disposable Postgres",
  () => {
    const postgres = testDatabase as WorkspacePostgresSuiteDatabase;

    test("cancels an invoice once with one corrective document and leaves the invoice untouched", async () => {
      const actor = await makeActor("cancellation-once");
      const invoice = await issueManualInvoice(actor);
      const [before] = await query("select * from invoices where id = $1", [
        invoice.id,
      ]);

      const first = await run(cancel({ invoiceId: invoice.id, actor }));
      const replay = await run(cancel({ invoiceId: invoice.id, actor }));

      expect(first.changed).toBe(true);
      expect(first.record).toMatchObject({
        invoiceId: invoice.id,
        cause: "invoice_cancellation",
        source: "dhw-cli",
        actor: {
          accountId: actor.administrator.accountId,
          email: actor.administrator.email,
        },
        notices: {
          customer: "not_owed",
          internal: "processing",
          needsAttention: false,
        },
      });
      expect(first.record.correctiveDocumentNumber).toMatch(
        /^WS-OD-\d{4}-\d{6}$/
      );
      expect(first.claims).toEqual([
        { audience: "internal", attemptNumber: 1 },
      ]);
      expect(replay).toEqual({
        changed: false,
        record: first.record,
        claims: [],
      });

      const [after] = await query("select * from invoices where id = $1", [
        invoice.id,
      ]);
      expect(after).toEqual(before!);
      const reread = await run(
        Effect.flatMap(InvoiceRepository, (invoices) =>
          invoices.findById(invoice.id)
        )
      );
      expect(reread).toEqual({
        ...invoice,
        cancellation: {
          cancelledAt: first.record.cancelledAt,
          cause: "invoice_cancellation",
          correctiveDocumentNumber: first.record.correctiveDocumentNumber,
        },
      });
      expect(
        await query(
          "select count(*)::int as count from corrective_documents where cancelled_invoice_id = $1",
          [invoice.id]
        )
      ).toEqual([{ count: 1 }]);
    });

    test("decrypts the corrective document that negates the cancelled invoice", async () => {
      const actor = await makeActor("cancellation-document");
      const invoice = await issueManualInvoice(actor);
      const { record } = await run(cancel({ invoiceId: invoice.id, actor }));

      const loaded = await run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          Effect.all([
            cancellations.loadCorrectiveDocument(invoice.id),
            // An invoice without a cancellation has no corrective document.
            cancellations.loadCorrectiveDocument(
              invoiceIdSchema.make(randomUUID())
            ),
          ])
        )
      );

      expect(loaded[0]).toMatchObject({
        documentKind: "invoice-cancellation",
        documentNumber: record.correctiveDocumentNumber,
        correctedInvoice: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        },
        lines: [{ amount: "-1200" }, { amount: "200" }],
        total: "-1000",
        settlement: "refund_due",
        provenance: { source: "dhw-cli", actor: actor.administrator.email },
      });
      expect(loaded[1]).toBeNull();
    });

    test("reports a database failure while loading the corrective document as the query error, not an unavailable document", async () => {
      const actor = await makeActor("cancellation-document-outage");
      const invoice = await issueManualInvoice(actor, sealingKeys);
      await run(cancel({ invoiceId: invoice.id, actor }), sealingKeys);
      const loadWith = (
        kit: { readonly run: typeof run },
        keys: IAccountingSnapshotKeyService
      ) =>
        kit.run(
          Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
            Effect.exit(cancellations.loadCorrectiveDocument(invoice.id))
          ),
          keys
        );
      const document = await run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          cancellations.loadCorrectiveDocument(invoice.id)
        ),
        sealingKeys
      );
      // Neither key, nor the texts of the corrective document or its invoice.
      const sensitive = [
        sealingKey.secret,
        wrongSecret,
        ...identifyingTexts({ document, invoice: invoice.document }, [
          invoice.id,
          invoice.invoiceNumber,
          invoice.dotyposCustomerId,
        ]),
      ];
      const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
        Exit.isFailure(exit)
          ? Exit.findErrorOption(exit).pipe(Option.getOrUndefined)
          : undefined;

      // A wrong key is the document's failure.
      const wrongKey = failureOf(await loadWith({ run }, wrongKeys));
      expect(wrongKey).toMatchObject({
        _tag: "InvoiceCancellationError",
        code: "document_unavailable",
        invoiceId: invoice.id,
      });

      // Only the decrypting statement reads the ciphertext: the key lookup
      // before it still succeeds.
      const renameCiphertext = (from: string, to: string) =>
        query(
          `alter table corrective_documents rename column ${from} to ${to}`
        );
      await renameCiphertext("encrypted_document", "encrypted_document_gone");
      const missingColumn = failureOf(
        await loadWith({ run }, sealingKeys).finally(() =>
          renameCiphertext("encrypted_document_gone", "encrypted_document")
        )
      );

      // The decrypting statement waits on a lock until it times out.
      const locking = lockingAfterKeyLookup({
        pool: testDatabase!.pool,
        table: "corrective_documents",
        keys: sealingKeys,
      });
      const timedOut = failureOf(
        await loadWith(timingOut, locking.keys).finally(locking.release)
      );

      for (const [error, sqlState] of [
        [missingColumn, "42703"],
        [timedOut, "57014"],
      ] as const) {
        expect(error).toMatchObject({ _tag: "EffectDrizzleQueryError" });
        expect(isDatabaseQueryError(error) && findSqlState(error)).toEqual(
          Option.some(sqlState)
        );
      }
      for (const error of [wrongKey, missingColumn, timedOut]) {
        expect(await findRenderedTexts(error, sensitive)).toEqual([]);
      }
    });

    test("allocates one number when concurrent requests cancel the same invoice", async () => {
      const actor = await makeActor("cancellation-concurrent");
      const invoice = await issueManualInvoice(actor);
      const before = await readCorrectiveCounters();

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          run(cancel({ invoiceId: invoice.id, actor }))
        )
      );

      expect(results.filter(({ changed }) => changed)).toHaveLength(1);
      expect(
        new Set(results.map(({ record }) => record.correctiveDocumentNumber))
          .size
      ).toBe(1);
      const after = await readCorrectiveCounters();
      const sequence = (rows: typeof before) =>
        rows.reduce((total, row) => total + row.last_sequence, 0);
      expect(sequence(after) - sequence(before)).toBe(1);
      expect(await readNotices(invoice.id)).toEqual([
        { audience: "internal", state: "processing", attempt_count: 1 },
      ]);
    });

    test("consumes no number and records nothing when the caller's transaction rolls back", async () => {
      const actor = await makeActor("cancellation-rollback");
      const invoice = await issueManualInvoice(actor);
      const before = await readCorrectiveCounters();

      const outcome = await run(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(
            Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
              cancellations.record({
                invoiceId: invoice.id,
                cause: "invoice_cancellation",
                actor,
                confirmedCustomerNotice: false,
              })
            ).pipe(Effect.andThen(new RolledBack({ reason: "test rollback" })))
          )
        ).pipe(Effect.flip)
      );

      expect(outcome).toBeInstanceOf(RolledBack);
      expect(await readCorrectiveCounters()).toEqual(before);
      expect(
        await query(
          "select invoice_id from invoice_cancellations where invoice_id = $1",
          [invoice.id]
        )
      ).toEqual([]);
      const next = await run(cancel({ invoiceId: invoice.id, actor }));
      const [year] = await readCorrectiveCounters().then((rows) =>
        rows.filter(
          (row) =>
            row.numbering_year ===
            Number(next.record.correctiveDocumentNumber.slice(6, 10))
        )
      );
      expect(next.record.correctiveDocumentNumber).toBe(
        `WS-OD-${year!.numbering_year}-${year!.last_sequence
          .toString()
          .padStart(6, "0")}`
      );
    });

    test("owes the customer a notice only when the invoice email was accepted for them", async () => {
      const actor = await makeActor("cancellation-sent");
      const sent = await issueManualInvoice(actor);
      await run(acceptInvoiceEmail(sent.id, "customer"));

      const stale = await run(
        cancel({ invoiceId: sent.id, actor }).pipe(Effect.flip)
      );
      expect(stale).toMatchObject({
        _tag: "InvoiceCancellationError",
        code: "confirmation_stale",
        invoiceId: sent.id,
      });
      expect(await readNotices(sent.id)).toEqual([]);
      expect(
        await query(
          "select invoice_id from invoice_cancellations where invoice_id = $1",
          [sent.id]
        )
      ).toEqual([]);

      const confirmed = await run(
        cancel({
          invoiceId: sent.id,
          actor,
          confirmedCustomerNotice: true,
        })
      );
      expect(confirmed.claims).toEqual([
        { audience: "customer", attemptNumber: 1 },
        { audience: "internal", attemptNumber: 1 },
      ]);
      expect(confirmed.record.notices).toEqual({
        customer: "processing",
        internal: "processing",
        needsAttention: false,
      });
    });

    test("asks for confirmation while the customer's invoice email is in flight but owes no notice yet", async () => {
      const actor = await makeActor("cancellation-in-flight");
      const invoice = await issueManualInvoice(actor);
      await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.claim({ invoiceId: invoice.id, audience: "customer" })
        )
      );

      expect(
        await run(cancel({ invoiceId: invoice.id, actor }).pipe(Effect.flip))
      ).toMatchObject({ code: "confirmation_stale" });
      const confirmed = await run(
        cancel({ invoiceId: invoice.id, actor, confirmedCustomerNotice: true })
      );
      expect(confirmed.claims).toEqual([
        { audience: "internal", attemptNumber: 1 },
      ]);
    });

    test("retries a failed notice and never reclaims an accepted one", async () => {
      const actor = await makeActor("cancellation-notice-ledger");
      const invoice = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: invoice.id, actor }));

      const outcomes = await run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          Effect.gen(function* () {
            const whileClaimed = yield* cancellations.claimNotice({
              invoiceId: invoice.id,
              audience: "internal",
            });
            yield* cancellations.markNoticeFailed({
              invoiceId: invoice.id,
              audience: "internal",
              attemptNumber: 1,
              failureCode: "email_send_failed",
            });
            const failed = yield* cancellations.find(invoice.id);
            const retry = yield* cancellations.claimNotice({
              invoiceId: invoice.id,
              audience: "internal",
            });
            // A superseded attempt's outcome changes nothing.
            yield* cancellations.markNoticeAccepted({
              invoiceId: invoice.id,
              audience: "internal",
              attemptNumber: 1,
              providerDeliveryId: EmailDeliveryIdSchema.make("superseded"),
              acceptedAt: Temporal.Now.instant(),
            });
            yield* cancellations.markNoticeAccepted({
              invoiceId: invoice.id,
              audience: "internal",
              attemptNumber: retry!.attemptNumber,
              providerDeliveryId: EmailDeliveryIdSchema.make("notice-sent"),
              acceptedAt: Temporal.Now.instant(),
            });
            const afterAcceptance = yield* cancellations.claimNotice({
              invoiceId: invoice.id,
              audience: "internal",
            });
            const accepted = yield* cancellations.find(invoice.id);
            return {
              whileClaimed,
              failed: failed?.notices,
              retry,
              afterAcceptance,
              accepted: accepted?.notices,
            };
          })
        )
      );

      expect(outcomes).toEqual({
        whileClaimed: null,
        failed: {
          customer: "not_owed",
          internal: "failed",
          needsAttention: true,
        },
        retry: { audience: "internal", attemptNumber: 2 },
        afterAcceptance: null,
        accepted: {
          customer: "not_owed",
          internal: "accepted",
          needsAttention: false,
        },
      });
      expect(
        await query(
          `select count(*)::int as count from invoice_cancellation_notice_deliveries
           where invoice_id = $1 and state = 'accepted'`,
          [invoice.id]
        )
      ).toEqual([{ count: 1 }]);
    });

    test("owes the customer a notice once an in-flight invoice email is accepted after the cancellation", async () => {
      const actor = await makeActor("cancellation-late-notice");
      const invoice = await issueManualInvoice(actor);
      const live = await issueManualInvoice(actor);
      const inFlight = await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.claim({ invoiceId: invoice.id, audience: "customer" })
        )
      );
      await run(
        cancel({ invoiceId: invoice.id, actor, confirmedCustomerNotice: true })
      );
      const claimCustomerNotice = (invoiceId: InvoiceId) =>
        run(
          Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
            cancellations.claimNotice({ invoiceId, audience: "customer" })
          )
        );

      const beforeAcceptance = await claimCustomerNotice(invoice.id);
      await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.markAccepted({
            invoiceId: invoice.id,
            audience: "customer",
            attemptNumber: (inFlight as { attemptNumber: number })
              .attemptNumber,
            providerDeliveryId: EmailDeliveryIdSchema.make("late-original"),
            acceptedAt: Temporal.Now.instant(),
          })
        )
      );
      const afterAcceptance = await claimCustomerNotice(invoice.id);
      const again = await claimCustomerNotice(invoice.id);

      expect([beforeAcceptance, afterAcceptance, again]).toEqual([
        null,
        { audience: "customer", attemptNumber: 1 },
        null,
      ]);
      // A live invoice has no cancellation for a notice to belong to.
      const refused = await run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          cancellations.claimNotice({
            invoiceId: live.id,
            audience: "internal",
          })
        )
      );
      expect(refused).toBeNull();
      expect(await readNotices(live.id)).toEqual([]);
    });

    test("claims the customer notice of an acceptance that lands while the cancellation is being recorded", async () => {
      const actor = await makeActor("cancellation-acceptance-race");
      const invoice = await issueManualInvoice(actor);
      const inFlight = await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.claim({ invoiceId: invoice.id, audience: "customer" })
        )
      );
      let paused!: () => void;
      const recordPaused = new Promise<void>((resolve) => {
        paused = resolve;
      });
      let resume!: () => void;
      const recordResumes = new Promise<void>((resolve) => {
        resume = resolve;
      });
      pauseBeforeActiveKey(() => {
        pauseBeforeActiveKey(undefined);
        paused();
        return recordResumes;
      });

      // The cancellation has read the customer's email as in flight and holds
      // the invoice row when the original sender records the acceptance.
      const cancellation = run(
        cancel({ invoiceId: invoice.id, actor, confirmedCustomerNotice: true })
      );
      await recordPaused;
      await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.markAccepted({
            invoiceId: invoice.id,
            audience: "customer",
            attemptNumber: (inFlight as { attemptNumber: number })
              .attemptNumber,
            providerDeliveryId: EmailDeliveryIdSchema.make("racing-original"),
            acceptedAt: Temporal.Now.instant(),
          })
        )
      );
      const lateClaim = run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          cancellations.claimNotice({
            invoiceId: invoice.id,
            audience: "customer",
          })
        )
      );
      await waitForPostgresLockWaiter(testDatabase!.pool, {
        condition: "locktype = 'transactionid'",
        description: "the late notice claim waiting for the cancellation",
      });
      resume();

      expect((await cancellation).claims).toEqual([
        { audience: "internal", attemptNumber: 1 },
      ]);
      expect(await lateClaim).toEqual({
        audience: "customer",
        attemptNumber: 1,
      });
    });

    test("reports a customer notice owed but never claimed as failed", async () => {
      const actor = await makeActor("cancellation-owed-unclaimed");
      const invoice = await issueManualInvoice(actor);
      const inFlight = await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.claim({ invoiceId: invoice.id, audience: "customer" })
        )
      );
      await run(
        cancel({ invoiceId: invoice.id, actor, confirmedCustomerNotice: true })
      );
      // The original email is accepted after the cancellation, and its late
      // notice claim never ran.
      await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.markAccepted({
            invoiceId: invoice.id,
            audience: "customer",
            attemptNumber: (inFlight as { attemptNumber: number })
              .attemptNumber,
            providerDeliveryId: EmailDeliveryIdSchema.make("late-unclaimed"),
            acceptedAt: Temporal.Now.instant(),
          })
        )
      );

      const summaries = await run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          Effect.gen(function* () {
            const owed = yield* cancellations.find(invoice.id);
            const retry = yield* cancellations.claimNotice({
              invoiceId: invoice.id,
              audience: "customer",
            });
            const retried = yield* cancellations.find(invoice.id);
            return { owed: owed?.notices, retry, retried: retried?.notices };
          })
        )
      );

      expect(summaries).toEqual({
        owed: {
          customer: "failed",
          internal: "processing",
          needsAttention: true,
        },
        retry: { audience: "customer", attemptNumber: 1 },
        retried: {
          customer: "processing",
          internal: "processing",
          needsAttention: false,
        },
      });
    });

    test("refuses original invoice email claims once the invoice is cancelled", async () => {
      const actor = await makeActor("cancellation-claim-refused");
      const invoice = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: invoice.id, actor }));

      const claims = await run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          Effect.all([
            deliveries.claim({ invoiceId: invoice.id, audience: "customer" }),
            deliveries.claim({ invoiceId: invoice.id, audience: "internal" }),
            deliveries.claimResend({ invoiceId: invoice.id }),
          ])
        )
      );

      expect(claims).toEqual(["cancelled", "cancelled", "cancelled"]);
      expect(
        await query(
          "select audience from invoice_email_deliveries where invoice_id = $1",
          [invoice.id]
        )
      ).toEqual([]);
    });

    test("keeps the actor's email but detaches the deleted account", async () => {
      const actor = await makeActor("cancellation-actor-deleted");
      const invoice = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: invoice.id, actor }));

      await postgres.pool.query('delete from auth."user" where id = $1', [
        actor.administrator.accountId,
      ]);

      const record = await run(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          cancellations.find(invoice.id)
        )
      );
      expect(record?.actor).toEqual({
        accountId: null,
        email: actor.administrator.email,
      });
    });

    test("rejects every change to an issued corrective document", async () => {
      const actor = await makeActor("cancellation-immutable");
      const invoice = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: invoice.id, actor }));

      for (const statement of [
        "update corrective_documents set issued_at = issued_at where cancelled_invoice_id = $1",
        "delete from corrective_documents where cancelled_invoice_id = $1",
      ]) {
        const failure = await postgres.pool.query(statement, [invoice.id]).then(
          () => null,
          (error: { readonly code?: string }) => error.code
        );
        expect(failure).toBe("55000");
      }
    });

    test("fails not_found for an unknown invoice", async () => {
      const actor = await makeActor("cancellation-unknown");
      const invoiceId = invoiceIdSchema.make(randomUUID());

      expect(
        await run(cancel({ invoiceId, actor }).pipe(Effect.flip))
      ).toMatchObject({ code: "not_found", invoiceId });
    });
  }
);
