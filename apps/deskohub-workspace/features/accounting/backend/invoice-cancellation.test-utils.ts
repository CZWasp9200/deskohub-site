import { randomUUID } from "node:crypto";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import type { QueryResultRow } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import {
  type InvoiceId,
  manualInvoiceInputSchema,
} from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceArchiveRepository } from "./invoice-archive.repository";
import { InvoiceCancellationRepository } from "./invoice-cancellation.repository";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";

/**
 * Issues manual invoices and cancels them through the real repositories on a
 * disposable Postgres, for suites about cancellation, archive and visibility.
 */
export const makeInvoiceCancellationTestKit = (
  database: WorkspacePostgresTestDatabase
) => {
  const testKey: AccountingSnapshotKey = {
    id: accountingSnapshotKeyIdSchema.make("K202611"),
    secret: "synthetic corrective document secret!",
  };

  const layer = () => {
    const base = Layer.merge(
      database.layer,
      Layer.succeed(
        AccountingSnapshotKeyService,
        AccountingSnapshotKeyService.of({
          getActive: Effect.succeed(testKey),
          getById: () => Effect.succeed(testKey),
        })
      )
    );
    return Layer.mergeAll(
      base,
      InvoiceArchiveRepository.Default.pipe(Layer.provide(base)),
      InvoiceCancellationRepository.Default.pipe(Layer.provide(base)),
      InvoiceEmailDeliveryRepository.Default.pipe(Layer.provide(base)),
      InvoiceRepository.Default.pipe(
        Layer.provide(
          Layer.merge(
            base,
            AccountingDocumentSnapshotRepository.Default.pipe(
              Layer.provide(base)
            )
          )
        )
      )
    );
  };

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      | InvoiceArchiveRepository
      | InvoiceCancellationRepository
      | InvoiceEmailDeliveryRepository
      | InvoiceRepository
      | WorkspaceDatabase
    >
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer())));

  const makeActor = async (label: string): Promise<AdministrationActor> => ({
    source: "dhw-cli",
    administrator: await Effect.runPromise(
      workspaceFixtures(database.db).account(label)
    ),
  });

  const issueManualInvoice = async (actor: AdministrationActor) => {
    const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
      invoiceId: randomUUID(),
      dotyposCustomerId: `invoice-cancellation-customer-${randomUUID()}`,
      buyer: {
        kind: "person",
        legalName: "Synthetic Cancelled Customer",
        address: {
          line1: "Synthetic 1",
          city: "Praha",
          postalCode: "100 00",
          country: "CZ",
        },
      },
      deliveryEmail: testEmailAddress("invoice-cancellation"),
      locale: "cs-CZ",
      serviceDate: "2099-01-01",
      payment: { status: "paid", date: "2099-01-01" },
      currency: "CZK",
      lines: [
        { description: "Synthetic rental", price: "1200.00" },
        { description: "Synthetic discount", price: "-200" },
      ],
      provenance: { source: "admin-ui", actor: actor.administrator.email },
    });
    const { invoice } = await run(
      Effect.flatMap(InvoiceRepository, (invoices) =>
        invoices.issueManual({ ...input, issuedBy: actor.administrator })
      )
    );
    return invoice;
  };

  const cancel = (input: {
    readonly invoiceId: InvoiceId;
    readonly actor: AdministrationActor;
    readonly confirmedCustomerNotice?: boolean;
  }) =>
    Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
      transaction(
        Effect.flatMap(InvoiceCancellationRepository, (cancellations) =>
          cancellations.record({
            invoiceId: input.invoiceId,
            cause: "invoice_cancellation",
            actor: input.actor,
            confirmedCustomerNotice: input.confirmedCustomerNotice ?? false,
          })
        )
      )
    );

  const acceptInvoiceEmail = (
    invoiceId: InvoiceId,
    audience: InvoiceEmailDeliveryAudience
  ) =>
    Effect.flatMap(InvoiceEmailDeliveryRepository, (deliveries) =>
      Effect.gen(function* () {
        const claim = yield* deliveries.claim({ invoiceId, audience });
        yield* deliveries.markAccepted({
          invoiceId,
          audience,
          attemptNumber: claim!.attemptNumber,
          providerDeliveryId: EmailDeliveryIdSchema.make(
            `email-${randomUUID()}`
          ),
          acceptedAt: Temporal.Now.instant(),
        });
      })
    );

  const query = async <Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ) => (await database.pool.query<Row>(text, [...values])).rows;

  return {
    acceptInvoiceEmail,
    cancel,
    issueManualInvoice,
    makeActor,
    query,
    run,
  };
};
