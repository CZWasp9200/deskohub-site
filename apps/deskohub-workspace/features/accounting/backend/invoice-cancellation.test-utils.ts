import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import type { QueryResultRow } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountingDocumentSnapshots, paymentAttempts } from "@/db/schema";
import {
  accountingSnapshotKeyIdSchema,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import {
  type InvoiceId,
  manualInvoiceInputSchema,
} from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
  type IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { encryptAccountingSnapshot } from "./accounting-snapshot-sql";
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

  // Runs before the active key is handed out. `record` reads it after its
  // delivery read, under its invoice row lock, so a test can pause it there.
  let beforeActiveKey: (() => Promise<void>) | undefined;
  const pauseBeforeActiveKey = (hook: (() => Promise<void>) | undefined) => {
    beforeActiveKey = hook;
  };

  /** The repositories over the suite database; `keys` replaces the test key. */
  const layer = (
    keys: IAccountingSnapshotKeyService = {
      getActive: Effect.promise(() =>
        beforeActiveKey ? beforeActiveKey() : Promise.resolve()
      ).pipe(Effect.as(testKey)),
      getById: () => Effect.succeed(testKey),
    }
  ) => {
    const base = Layer.merge(
      database.layer,
      Layer.succeed(
        AccountingSnapshotKeyService,
        AccountingSnapshotKeyService.of(keys)
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

  /**
   * A confirmed, paid and fulfilled cowork reservation with its accounting
   * snapshot; `issueInvoice` issues (or, on retry, returns) its invoice.
   */
  const createPaidReservation = async () => {
    const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
    const dotyposCustomerId = DotyposCustomerIdSchema.make(
      `invoice-cancellation-customer-${randomUUID()}`
    );
    const dotyposReservationId = DotyposReservationIdSchema.make(
      `synthetic-reservation-${randomUUID()}`
    );
    const now = Temporal.Instant.from(
      temporalInstantToIsoString(Temporal.Now.instant())
    );
    const order = { entryTier: "open-space", coffee: true } as const;
    const prepared = {
      kind: "cowork",
      reservation: {
        kind: "cowork",
        ...order,
        date: "2099-01-01",
        name: "Synthetic Reservation Customer",
        email: testEmailAddress("invoice-cancellation-reservation"),
        phone: "+420 700 000 000",
      },
      quote: buildCoworkReservationQuote(order),
    } as PreparedCustomerQuote;
    const reservation = await run(
      Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
        transaction(
          Effect.gen(function* () {
            const created = yield* workspaceFixtures(db).reservation({
              stage: {
                reservation: "confirmed",
                payment: "paid",
                fulfillment: "fulfilled",
              },
              customer: dotyposCustomerId,
              at: now,
              overrides: {
                dotyposReservationId,
                activePaymentAttemptId: paymentAttemptId,
              },
            });
            const source = makeAccountingDocumentSnapshot({
              workspaceReservationId: created.id,
              dotyposReservationId,
              dotyposCustomerId,
              locale: "en-US",
              prepared,
            });
            yield* db.insert(paymentAttempts).values({
              id: paymentAttemptId,
              workspaceReservationId: created.id,
              provider: "nexi",
              providerOrderId: NexiOrderIdSchema.make(
                `synthetic-order-${randomUUID()}`
              ),
              state: "paid",
              amountValue: source.quote.payment.expectedPrice.value,
              amountExponent: source.quote.payment.expectedPrice.exponent,
              currency: source.quote.payment.expectedPrice.currency,
            });
            yield* db.insert(accountingDocumentSnapshots).values({
              paymentAttemptId,
              workspaceReservationId: created.id,
              keyId: testKey.id,
              encryptedSnapshot: encryptAccountingSnapshot(
                JSON.stringify(source),
                testKey.secret
              ),
            });
            return created;
          })
        )
      )
    );
    const issueInvoice = () =>
      Effect.flatMap(InvoiceRepository, (invoices) =>
        invoices.issue({
          paymentAttemptId,
          buyer: {
            kind: "person",
            legalName: "Synthetic Reservation Customer",
            address: {
              line1: "Synthetic 1",
              city: "Praha",
              postalCode: "100 00",
              country: "CZ",
            },
          },
        })
      ).pipe(Effect.provide(layer()));
    return { issueInvoice, paymentAttemptId, reservation };
  };

  /** A paid reservation, as `createPaidReservation` makes, with its invoice. */
  const issueReservationInvoice = async () => {
    const paid = await createPaidReservation();
    const { invoice } = await Effect.runPromise(paid.issueInvoice());
    return { ...paid, invoice };
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
        if (claim === null || claim === "cancelled") {
          return yield* Effect.die(
            new Error("The invoice email fixture could not be claimed.")
          );
        }
        yield* deliveries.markAccepted({
          invoiceId,
          audience,
          attemptNumber: claim.attemptNumber,
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
    createPaidReservation,
    issueManualInvoice,
    issueReservationInvoice,
    layer,
    makeActor,
    pauseBeforeActiveKey,
    query,
    run,
  };
};
