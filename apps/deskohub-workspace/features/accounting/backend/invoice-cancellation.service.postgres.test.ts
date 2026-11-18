import "@/shared/testing/workspace-test-env";
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import {
  findRenderedTexts,
  identifyingTexts,
} from "@/shared/testing/rendered-representations.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  type IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import {
  InvoiceCancellationRepository,
  type InvoiceNoticeClaim,
} from "./invoice-cancellation.repository";
import { InvoiceCancellationService } from "./invoice-cancellation.service";
import { makeInvoiceCancellationTestKit } from "./invoice-cancellation.test-utils";
import { InvoiceCancellationNotices } from "./invoice-cancellation-notices";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";
import { InvoiceEmailDeliveryError } from "./invoice-email-delivery.service";

// The suite counts corrective document numbers, so it owns its database.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "invoice_cancellation_service"
);
afterAll(() => testDatabase?.close());

const kit = makeInvoiceCancellationTestKit(testDatabase!);

type Delivered = {
  invoiceId: InvoiceId;
  claims: readonly InvoiceNoticeClaim[];
};

/**
 * The service over the suite database with a notice delivery that records
 * what it was asked to send and accepts it on the ledger, or fails.
 */
const makeService = (
  options: {
    readonly keys?: IAccountingSnapshotKeyService;
    readonly noticesFail?: boolean;
  } = {}
) => {
  const delivered: Delivered[] = [];
  const repositories = kit.layer(options.keys);
  const notices = Layer.effect(
    InvoiceCancellationNotices,
    Effect.gen(function* () {
      const ledger = yield* InvoiceCancellationRepository;
      return InvoiceCancellationNotices.of({
        deliver: ({ invoiceId, claims }) =>
          Effect.gen(function* () {
            delivered.push({ invoiceId, claims });
            for (const claim of claims) {
              yield* options.noticesFail
                ? ledger.markNoticeFailed({
                    invoiceId,
                    ...claim,
                    failureCode: "email_send_failed",
                  })
                : ledger.markNoticeAccepted({
                    invoiceId,
                    ...claim,
                    providerDeliveryId: EmailDeliveryIdSchema.make(
                      `notice-${randomUUID()}`
                    ),
                    acceptedAt: Temporal.Now.instant(),
                  });
            }
            if (options.noticesFail) {
              return yield* new InvoiceEmailDeliveryError({
                code: "email_delivery_failed",
                paymentAttemptId: invoiceId,
                message: "Synthetic notice failure",
              });
            }
            const record = yield* ledger.find(invoiceId).pipe(Effect.orDie);
            return { changed: true, notices: record!.notices };
          }).pipe(
            Effect.catchTag("EffectDrizzleQueryError", (cause) =>
              Effect.die(cause)
            )
          ),
        ensureOwed: () => Effect.void,
      });
    })
  ).pipe(Layer.provide(repositories));
  const layer = InvoiceCancellationService.Default.pipe(
    Layer.provide(Layer.mergeAll(repositories, notices))
  );
  const run = <A, E>(
    operation: (
      service: InvoiceCancellationService["Service"]
    ) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      InvoiceCancellationService.pipe(
        Effect.flatMap(operation),
        Effect.provide(layer)
      )
    );
  return { delivered, run };
};

const sealingKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K209904"),
  secret: "synthetic cancellation service secret!",
};
const sealingKeys: IAccountingSnapshotKeyService = {
  getActive: Effect.succeed(sealingKey),
  getById: () => Effect.succeed(sealingKey),
};
const wrongSecret = "synthetic cancellation service wrong secret!";
const wrongKeys: IAccountingSnapshotKeyService = {
  getActive: Effect.succeed(sealingKey),
  getById: (keyId) => Effect.succeed({ id: keyId, secret: wrongSecret }),
};

/** Neither key, nor the texts of the invoice's document. */
const sensitiveTexts = (
  invoice: Awaited<ReturnType<typeof kit.issueManualInvoice>>
) => [
  sealingKey.secret,
  wrongSecret,
  ...identifyingTexts(invoice.document, [
    invoice.id,
    invoice.invoiceNumber,
    invoice.dotyposCustomerId,
  ]),
];

const readCancellationCount = async (invoiceId: InvoiceId) =>
  Number(
    (
      await kit.query<{ count: string }>(
        "select count(*) from invoice_cancellations where invoice_id = $1",
        [invoiceId]
      )
    )[0]!.count
  );

const setReservationState = (reservationId: string, state: string) =>
  kit.query(
    "update workspace_reservations set reservation_state = $2 where id = $1",
    [reservationId, state]
  );

describe.skipIf(!testDatabase)(
  "InvoiceCancellationService on disposable Postgres",
  () => {
    test("cancels a manual invoice once: one corrective number and one set of notices on replay", async () => {
      const actor = await kit.makeActor("service-once");
      const invoice = await kit.issueManualInvoice(actor);
      const { delivered, run } = makeService();

      const plan = await run((service) => service.plan(invoice.id));
      const first = await run((service) =>
        service.cancelStandalone({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: false,
        })
      );
      const replay = await run((service) =>
        service.cancelStandalone({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: false,
        })
      );

      expect(plan).toEqual({
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          reservationId: null,
          cancelled: false,
        },
        customerNotice: "not_owed",
        reservation: "none",
      });
      expect(first.outcome).toBe("cancelled");
      expect(first.cancellation.correctiveDocumentNumber).toMatch(
        /^WS-OD-\d{4}-\d{6,}$/
      );
      expect(replay.outcome).toBe("already_cancelled");
      expect(replay.cancellation.correctiveDocumentNumber).toBe(
        first.cancellation.correctiveDocumentNumber
      );
      // Never sent to the customer: only the internal copy is owed.
      expect(delivered).toEqual([
        {
          invoiceId: invoice.id,
          claims: [{ audience: "internal", attemptNumber: 1 }],
        },
      ]);
      expect(first.cancellation.notices).toMatchObject({
        customer: "not_owed",
        internal: "accepted",
      });
      expect(
        (await run((service) => service.plan(invoice.id))).invoice.cancelled
      ).toBe(true);
    });

    test("an invoice sent to the customer owes them a notice and refuses an unconfirmed cancellation", async () => {
      const actor = await kit.makeActor("service-sent");
      const invoice = await kit.issueManualInvoice(actor);
      await kit.run(kit.acceptInvoiceEmail(invoice.id, "customer"));
      const { delivered, run } = makeService();

      const plan = await run((service) => service.plan(invoice.id));
      const stale = await run((service) =>
        Effect.flip(
          service.cancelStandalone({
            invoiceId: invoice.id,
            actor,
            confirmedCustomerNotice: false,
          })
        )
      );
      const confirmed = await run((service) =>
        service.cancelStandalone({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: true,
        })
      );

      expect(plan.customerNotice).toBe("owed");
      expect(stale.code).toBe("confirmation_stale");
      expect(confirmed.outcome).toBe("cancelled");
      expect(delivered).toHaveLength(1);
      expect(
        delivered[0]!.claims.map(({ audience }) => audience).toSorted()
      ).toEqual(["customer", "internal"]);
    });

    test("an unreadable invoice document fails document_unavailable before anything is written", async () => {
      const actor = await kit.makeActor("service-unreadable");
      const invoice = await kit.issueManualInvoice(actor);
      const missingKey = new AccountingSnapshotKeyError({
        keyId: "K202611",
        message: "Synthetic key is unavailable.",
      });
      const { delivered, run } = makeService({
        keys: {
          getActive: Effect.fail(missingKey),
          getById: () => Effect.fail(missingKey),
        },
      });
      const countersBefore = await kit.query(
        "select * from corrective_document_number_counters"
      );

      const planned = await run((service) =>
        Effect.flip(service.plan(invoice.id))
      );
      const cancelled = await run((service) =>
        Effect.flip(
          service.cancelStandalone({
            invoiceId: invoice.id,
            actor,
            confirmedCustomerNotice: true,
          })
        )
      );

      expect(planned.code).toBe("document_unavailable");
      expect(cancelled.code).toBe("document_unavailable");
      expect(await readCancellationCount(invoice.id)).toBe(0);
      expect(
        await kit.query("select * from corrective_document_number_counters")
      ).toEqual(countersBefore);
      expect(delivered).toEqual([]);
    });

    test("a database failure while reading the invoice fails persistence_failed before anything is written", async () => {
      const actor = await kit.makeActor("service-outage");
      const invoice = await kit.issueManualInvoice(actor, sealingKeys);
      const { delivered, run } = makeService({ keys: sealingKeys });
      const countersBefore = await kit.query(
        "select * from corrective_document_number_counters"
      );
      // Only the decrypting statement reads the ciphertext: the row lock, the
      // key lookup and the invoice's standing before it still succeed.
      const renameCiphertext = (from: string, to: string) =>
        kit.query(`alter table invoices rename column ${from} to ${to}`);
      await renameCiphertext("encrypted_document", "encrypted_document_gone");

      const cancelled = await run((service) =>
        Effect.flip(
          service.cancelStandalone({
            invoiceId: invoice.id,
            actor,
            confirmedCustomerNotice: true,
          })
        )
      ).finally(() =>
        renameCiphertext("encrypted_document_gone", "encrypted_document")
      );

      expect(cancelled.code).toBe("persistence_failed");
      expect(await readCancellationCount(invoice.id)).toBe(0);
      expect(
        await kit.query("select * from corrective_document_number_counters")
      ).toEqual(countersBefore);
      expect(delivered).toEqual([]);
      expect(
        await findRenderedTexts(cancelled, sensitiveTexts(invoice))
      ).toEqual([]);
    });

    test("an invoice sealed under another key fails document_unavailable without rendering a key or the document", async () => {
      const actor = await kit.makeActor("service-wrong-key");
      const invoice = await kit.issueManualInvoice(actor, sealingKeys);
      const { delivered, run } = makeService({ keys: wrongKeys });

      const cancelled = await run((service) =>
        Effect.flip(
          service.cancelStandalone({
            invoiceId: invoice.id,
            actor,
            confirmedCustomerNotice: true,
          })
        )
      );

      expect(cancelled.code).toBe("document_unavailable");
      expect(await readCancellationCount(invoice.id)).toBe(0);
      expect(delivered).toEqual([]);
      expect(
        await findRenderedTexts(cancelled, sensitiveTexts(invoice))
      ).toEqual([]);
    });

    test("routes a reservation invoice by its reservation and cancels a legacy-cancelled reservation's invoice alone", async () => {
      const actor = await kit.makeActor("service-reservation");
      const { invoice, reservation } = await kit.issueReservationInvoice();
      const { run } = makeService();

      const live = await run((service) =>
        service.planForReservation(reservation.id)
      );
      const refused = await run((service) =>
        Effect.flip(
          service.cancelStandalone({
            invoiceId: invoice.id,
            actor,
            confirmedCustomerNotice: true,
          })
        )
      );
      await setReservationState(reservation.id, "cancelling");
      const inProgress = await run((service) => service.plan(invoice.id));
      const refusedInProgress = await run((service) =>
        Effect.flip(
          service.cancelStandalone({
            invoiceId: invoice.id,
            actor,
            confirmedCustomerNotice: true,
          })
        )
      );
      // A reservation cancelled before invoice cancellation existed kept
      // its live invoice.
      await setReservationState(reservation.id, "cancelled");
      const legacy = await run((service) => service.plan(invoice.id));
      const cancelled = await run((service) =>
        service.cancelStandalone({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: true,
        })
      );

      expect(live).toMatchObject({
        invoice: { id: invoice.id, reservationId: reservation.id },
        reservation: "cancels_reservation",
      });
      expect(refused.code).toBe("reservation_confirmation_required");
      expect(inProgress.reservation).toBe("cancellation_in_progress");
      expect(refusedInProgress.code).toBe(
        "reservation_cancellation_in_progress"
      );
      expect(legacy.reservation).toBe("already_cancelled");
      expect(cancelled).toMatchObject({
        outcome: "cancelled",
        cancellation: { cause: "invoice_cancellation" },
      });
      expect(
        await run((service) => service.planForReservation(reservation.id))
      ).toBeNull();
    });

    test("retries the customer notice owed after a late acceptance of the invoice email", async () => {
      const actor = await kit.makeActor("service-late");
      const invoice = await kit.issueManualInvoice(actor);
      // The customer's invoice email is in flight when the invoice is
      // cancelled, and the provider accepts it afterwards.
      const inFlight = await kit.run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.claim({ invoiceId: invoice.id, audience: "customer" })
        )
      );
      const { run } = makeService();
      const cancelled = await run((service) =>
        service.cancelStandalone({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: true,
        })
      );
      if (inFlight === null || inFlight === "cancelled") {
        throw new Error("The invoice email fixture could not be claimed.");
      }
      await kit.run(
        Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
          deliveries.markAccepted({
            invoiceId: invoice.id,
            audience: "customer",
            attemptNumber: inFlight.attemptNumber,
            providerDeliveryId: EmailDeliveryIdSchema.make(
              `email-${randomUUID()}`
            ),
            acceptedAt: Temporal.Now.instant(),
          })
        )
      );
      const retry = makeService();

      const retried = await retry.run((service) =>
        service.retryNotices(invoice.id)
      );

      expect(cancelled.cancellation.notices.customer).toBe("not_owed");
      expect(retry.delivered).toEqual([
        {
          invoiceId: invoice.id,
          claims: [{ audience: "customer", attemptNumber: 1 }],
        },
      ]);
      expect(retried.notices).toMatchObject({
        customer: "accepted",
        internal: "accepted",
        needsAttention: false,
      });
    });

    test("retries a failed notice of a cancelled invoice and never sends an accepted one again", async () => {
      const actor = await kit.makeActor("service-retry");
      const invoice = await kit.issueManualInvoice(actor);
      const failing = makeService({ noticesFail: true });

      const cancelled = await failing.run((service) =>
        service.cancelStandalone({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: false,
        })
      );
      const healthy = makeService();
      const retried = await healthy.run((service) =>
        service.retryNotices(invoice.id)
      );
      const again = await healthy.run((service) =>
        service.retryNotices(invoice.id)
      );
      const live = await kit.issueManualInvoice(actor);
      const notCancelled = await healthy.run((service) =>
        Effect.flip(service.retryNotices(live.id))
      );

      expect(cancelled.outcome).toBe("cancelled");
      expect(cancelled.cancellation.notices).toMatchObject({
        internal: "failed",
        needsAttention: true,
      });
      expect(retried.changed).toBe(true);
      expect(retried.notices).toMatchObject({
        internal: "accepted",
        needsAttention: false,
      });
      expect(healthy.delivered).toEqual([
        {
          invoiceId: invoice.id,
          claims: [{ audience: "internal", attemptNumber: 2 }],
        },
      ]);
      expect(again.changed).toBe(false);
      expect(notCancelled.code).toBe("not_found");
    });
  }
);
