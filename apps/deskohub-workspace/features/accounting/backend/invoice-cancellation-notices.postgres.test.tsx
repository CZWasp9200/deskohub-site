import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
} from "@deskohub/email";
import {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { Effect, Layer } from "effect";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { workspaceDefaultFromAddress } from "@/shared/backend/config/email.config";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { InvoiceCancellationRepository } from "./invoice-cancellation.repository";
import { makeInvoiceCancellationTestKit } from "./invoice-cancellation.test-utils";
import {
  type IInvoiceCancellationNotices,
  InvoiceCancellationNotices,
} from "./invoice-cancellation-notices";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";

mock.module("server-only", () => ({}));

// Cancellations pin their invoices, which suites sharing the configured
// database delete, so the suite owns its database.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "invoice_cancellation_notices"
);
afterAll(() => testDatabase?.close());
// The kit only touches the database when a test calls it.
const kit = makeInvoiceCancellationTestKit(testDatabase!);
const { cancel, issueManualInvoice, makeActor, query, run } = kit;

const emailConfig: EmailProviderConfig = {
  provider: "console",
  defaultFrom: {
    email: workspaceDefaultFromAddress,
    name: "Deskohub Workspace",
  },
};

const noticeCategory = "workspace-invoice-cancellation-notice";

/** A fake email service that records each message and can refuse some. */
const makeMailbox = () => {
  const sent: EmailMessage[] = [];
  let failing = (_message: EmailMessage) => false;
  let onSend = (_message: EmailMessage): Effect.Effect<void> => Effect.void;
  const service = {
    send: (message: EmailMessage) =>
      Effect.gen(function* () {
        yield* onSend(message);
        if (failing(message)) {
          return yield* new EmailServiceError("synthetic provider failure");
        }
        sent.push(message);
        return {
          id: EmailDeliveryIdSchema.make(`email-${sent.length}`),
          status: "sent" as const,
          provider: "test",
          timestamp: new Date(),
        };
      }),
    sendBatch: () => Effect.die("Notice tests do not send batches."),
  };
  return {
    sent,
    notices: () =>
      sent.filter((message) => message.tags?.[0] === noticeCategory),
    failWhen: (predicate: (message: EmailMessage) => boolean) => {
      failing = predicate;
    },
    beforeSend: (effect: (message: EmailMessage) => Effect.Effect<void>) => {
      onSend = effect;
    },
    layer: Layer.mergeAll(
      Layer.succeed(EmailServiceTag, service),
      Layer.succeed(EmailConfigTag, emailConfig)
    ),
  };
};

// Manual invoices carry their recipient, so the snapshot reader stays unused.
const unusedSnapshots = Layer.succeed(AccountingDocumentSnapshots, {
  find: () => Effect.die("manual invoices have no source snapshot"),
} as never);

const noticesLayer = (mailbox: ReturnType<typeof makeMailbox>) =>
  InvoiceCancellationNotices.Default.pipe(
    Layer.provide(Layer.mergeAll(mailbox.layer, unusedSnapshots))
  );

const withNotices = <A, E>(
  mailbox: ReturnType<typeof makeMailbox>,
  effect: Effect.Effect<A, E, InvoiceCancellationNotices>
) => run(effect.pipe(Effect.provide(noticesLayer(mailbox))));

const deliverOriginal = (
  mailbox: ReturnType<typeof makeMailbox>,
  invoiceId: InvoiceId
) =>
  run(
    Effect.flatMap(InvoiceEmailDeliveryService, (service) =>
      service.deliverByInvoiceId({ invoiceId })
    ).pipe(
      Effect.provide(
        InvoiceEmailDeliveryService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              mailbox.layer,
              unusedSnapshots,
              noticesLayer(mailbox)
            )
          )
        )
      )
    )
  );

const deliverNotices = (
  mailbox: ReturnType<typeof makeMailbox>,
  input: Parameters<IInvoiceCancellationNotices["deliver"]>[0]
) =>
  withNotices(
    mailbox,
    Effect.flatMap(InvoiceCancellationNotices, (notices) =>
      notices.deliver(input)
    )
  );

const ensureOwed = (
  mailbox: ReturnType<typeof makeMailbox>,
  invoiceId: InvoiceId
) =>
  withNotices(
    mailbox,
    Effect.flatMap(InvoiceCancellationNotices, (notices) =>
      notices.ensureOwed(invoiceId)
    )
  );

const claimNotice = (
  invoiceId: InvoiceId,
  audience: InvoiceEmailDeliveryAudience
) =>
  run(
    Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
      cancellations.claimNotice({ invoiceId, audience })
    )
  );

const readNotices = (invoiceId: InvoiceId) =>
  query<{
    audience: string;
    state: string;
    attempt_count: number;
    accepted_at: Date | null;
  }>(
    `select audience, state, attempt_count, accepted_at
     from invoice_cancellation_notice_deliveries
     where invoice_id = $1 order by audience`,
    [invoiceId]
  );

const audienceOf = (message: EmailMessage) =>
  (message.metadata as { audience: InvoiceEmailDeliveryAudience }).audience;

describe.skipIf(!testDatabase)(
  "InvoiceCancellationNotices on disposable Postgres",
  () => {
    test("a never-sent invoice notifies only internal accounting, with the corrective PDF", async () => {
      const mailbox = makeMailbox();
      const actor = await makeActor("notice-never-sent");
      const invoice = await issueManualInvoice(actor);
      const recording = await run(cancel({ invoiceId: invoice.id, actor }));

      const result = await deliverNotices(mailbox, {
        invoiceId: invoice.id,
        claims: recording.claims,
      });

      expect(recording.claims.map((claim) => claim.audience)).toEqual([
        "internal",
      ]);
      expect(result).toEqual({
        changed: true,
        notices: {
          customer: "not_owed",
          internal: "accepted",
          needsAttention: false,
        },
      });
      expect(mailbox.notices().map(audienceOf)).toEqual(["internal"]);
      const [notice] = mailbox.notices();
      const [attachment] = notice!.attachments ?? [];
      expect(attachment?.filename).toBe(
        `${recording.record.correctiveDocumentNumber}.pdf`
      );
      expect(
        Buffer.from(attachment!.content as Buffer)
          .subarray(0, 5)
          .toString()
      ).toBe("%PDF-");
      expect(notice!.idempotencyKey).toBe(
        `workspace-invoice-cancellation-internal-${invoice.id}`
      );
      expect(await readNotices(invoice.id)).toMatchObject([
        { audience: "internal", state: "accepted", attempt_count: 1 },
      ]);
    });

    test("a sent invoice notifies the customer and internal accounting at the original recipients", async () => {
      const mailbox = makeMailbox();
      const actor = await makeActor("notice-sent");
      const invoice = await issueManualInvoice(actor);
      await deliverOriginal(mailbox, invoice.id);
      const original = new Map(
        mailbox.sent.map((message) => [audienceOf(message), message.to])
      );
      const recording = await run(
        cancel({ invoiceId: invoice.id, actor, confirmedCustomerNotice: true })
      );

      const result = await deliverNotices(mailbox, {
        invoiceId: invoice.id,
        claims: recording.claims,
      });

      expect(result.notices).toMatchObject({
        customer: "accepted",
        internal: "accepted",
      });
      expect(
        mailbox.notices().map((message) => [audienceOf(message), message.to])
      ).toEqual([
        ["customer", original.get("customer")],
        ["internal", original.get("internal")],
      ]);
      expect(
        mailbox.notices().map((message) => message.attachments?.[0]?.filename)
      ).toEqual([
        `${recording.record.correctiveDocumentNumber}.pdf`,
        `${recording.record.correctiveDocumentNumber}.pdf`,
      ]);
    });

    test("a failed notice stays retryable and is accepted once", async () => {
      const mailbox = makeMailbox();
      const actor = await makeActor("notice-retry");
      const invoice = await issueManualInvoice(actor);
      const recording = await run(cancel({ invoiceId: invoice.id, actor }));
      mailbox.failWhen(() => true);

      await expect(
        deliverNotices(mailbox, {
          invoiceId: invoice.id,
          claims: recording.claims,
        })
      ).rejects.toMatchObject({
        _tag: "InvoiceEmailDeliveryError",
        code: "email_delivery_failed",
      });
      expect(await readNotices(invoice.id)).toMatchObject([
        { audience: "internal", state: "failed", attempt_count: 1 },
      ]);

      mailbox.failWhen(() => false);
      const retry = await claimNotice(invoice.id, "internal");
      const retried = await deliverNotices(mailbox, {
        invoiceId: invoice.id,
        claims: [retry!],
      });
      const replay = await run(cancel({ invoiceId: invoice.id, actor }));
      const replayed = await deliverNotices(mailbox, {
        invoiceId: invoice.id,
        claims: replay.claims,
      });

      expect(retry).toEqual({ audience: "internal", attemptNumber: 2 });
      expect(retried.notices.internal).toBe("accepted");
      expect(await claimNotice(invoice.id, "internal")).toBeNull();
      expect(replay).toMatchObject({ changed: false, claims: [] });
      expect(replayed.changed).toBe(false);
      expect(mailbox.notices()).toHaveLength(1);
      expect(await readNotices(invoice.id)).toMatchObject([
        { audience: "internal", state: "accepted", attempt_count: 2 },
      ]);
    });

    test("an internal failure keeps the customer's accepted notice and reports it", async () => {
      const mailbox = makeMailbox();
      const actor = await makeActor("notice-internal-failure");
      const invoice = await issueManualInvoice(actor);
      await deliverOriginal(mailbox, invoice.id);
      const recording = await run(
        cancel({ invoiceId: invoice.id, actor, confirmedCustomerNotice: true })
      );
      mailbox.failWhen((message) => audienceOf(message) === "internal");

      await expect(
        deliverNotices(mailbox, {
          invoiceId: invoice.id,
          claims: recording.claims,
        })
      ).rejects.toMatchObject({
        code: "email_delivery_failed",
        customerDelivered: true,
      });
      expect(await readNotices(invoice.id)).toMatchObject([
        { audience: "customer", state: "accepted" },
        { audience: "internal", state: "failed" },
      ]);
      expect(await claimNotice(invoice.id, "customer")).toBeNull();
    });

    test("owes the customer nothing for a live or never-sent invoice", async () => {
      const mailbox = makeMailbox();
      const actor = await makeActor("notice-not-owed");
      const live = await issueManualInvoice(actor);
      const neverSent = await issueManualInvoice(actor);
      await run(cancel({ invoiceId: neverSent.id, actor }));

      await ensureOwed(mailbox, live.id);
      await ensureOwed(mailbox, neverSent.id);

      expect(mailbox.notices()).toEqual([]);
      expect(await readNotices(live.id)).toEqual([]);
      expect(
        (await readNotices(neverSent.id)).map((row) => row.audience)
      ).toEqual(["internal"]);
    });

    test("an original email accepted after the cancellation sends the customer notice exactly once", async () => {
      const mailbox = makeMailbox();
      const actor = await makeActor("notice-late-acceptance");
      const invoice = await issueManualInvoice(actor);
      const cancellations: { claims: readonly { audience: string }[] }[] = [];
      // The administrator cancels while the customer's original email is
      // with the provider: the claim was taken, acceptance not yet recorded.
      mailbox.beforeSend((message) =>
        message.tags?.[0] === "workspace-invoice-customer"
          ? Effect.promise(() =>
              run(
                cancel({
                  invoiceId: invoice.id,
                  actor,
                  confirmedCustomerNotice: true,
                })
              ).then((result) => {
                cancellations.push(result);
              })
            )
          : Effect.void
      );

      await expect(deliverOriginal(mailbox, invoice.id)).rejects.toMatchObject({
        code: "invoice_cancelled",
        customerDelivered: true,
      });
      mailbox.beforeSend(() => Effect.void);
      // A later pass of the original sender finds the notice already sent.
      await ensureOwed(mailbox, invoice.id);

      expect(cancellations).toHaveLength(1);
      expect(cancellations[0]?.claims.map((claim) => claim.audience)).toEqual([
        "internal",
      ]);
      expect(mailbox.notices().map(audienceOf)).toEqual(["customer"]);
      expect(await readNotices(invoice.id)).toMatchObject([
        { audience: "customer", state: "accepted", attempt_count: 1 },
        { audience: "internal", state: "processing" },
      ]);
    });
  }
);
