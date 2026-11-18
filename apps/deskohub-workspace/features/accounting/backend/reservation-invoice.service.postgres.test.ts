import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  type DotyposCustomerBillingDetails,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { asc, eq } from "drizzle-orm";
import { Deferred, Effect, Layer, Ref } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceNumberCounters, invoices, paymentAttempts } from "@/db/schema";
import {
  accountingSnapshotKeyIdSchema,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import {
  type InvoiceBuyerAddress,
  toDotyposCustomerBillingDetails,
} from "@/features/accounting/billing-identity";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { recordAccountingDocumentSnapshot } from "./accounting-document-snapshots.test-utils";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { testAccountingStorage } from "./accounting-storage.test-utils";
import { InvoiceRepository } from "./invoice.repository";
import {
  type IReservationInvoiceService,
  ReservationInvoiceService,
} from "./reservation-invoice.service";

mock.module("server-only", () => ({}));

const { InvoiceEmailDeliveryService } = await import(
  "./invoice-email-delivery.service"
);

// The counters only move through this suite's issuances.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "reservation_invoice_service"
);
afterAll(() => testDatabase?.close());

const testKey = {
  id: accountingSnapshotKeyIdSchema.make("K202608"),
  secret: "synthetic accounting snapshot secret!",
};
const keysLayer = Layer.succeed(
  AccountingSnapshotKeyService,
  AccountingSnapshotKeyService.of({
    getActive: Effect.succeed(testKey),
    getById: () => Effect.succeed(testKey),
  })
);

const coworkOrder = {
  entryTier: "open-space",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;
const customerName = "Synthetic Invoice Customer";
const frozenAddress = {
  line1: "Frozen 1",
  city: "Praha",
  postalCode: "100 00",
  country: "CZ",
} satisfies InvoiceBuyerAddress;
const firstAddress = {
  line1: "Submitted 1",
  city: "Brno",
  postalCode: "602 00",
  country: "CZ",
} satisfies InvoiceBuyerAddress;
const secondAddress = {
  line1: "Submitted 2",
  line2: "Unit 4",
  city: "Bratislava",
  postalCode: "811 01",
  country: "SK",
} satisfies InvoiceBuyerAddress;

/**
 * A paid, confirmed, fulfilled personal reservation whose active attempt froze
 * `billing`, with the snapshot recorded as checkout records it.
 */
const createFulfilledReservation = async (
  billing: ReservationBillingSelection
) => {
  const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
  const dotyposCustomerId = DotyposCustomerIdSchema.make(
    `reservation-invoice-customer-${randomUUID()}`
  );
  const dotyposReservationId = DotyposReservationIdSchema.make(
    `synthetic-reservation-${randomUUID()}`
  );
  const prepared = {
    kind: "cowork",
    reservation: {
      kind: "cowork",
      ...coworkOrder,
      date: "2099-01-01",
      name: customerName,
      email: testEmailAddress("reservation-invoice-service"),
      phone: "+420 700 000 000",
      billing,
    },
    quote: buildCoworkReservationQuote(coworkOrder),
  } as PreparedCustomerQuote;
  const at = Temporal.Instant.from(
    temporalInstantToIsoString(Temporal.Now.instant())
  );

  const reservationId = await Effect.runPromise(
    Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
      transaction(
        Effect.gen(function* () {
          const reservation = yield* workspaceFixtures(db).reservation({
            stage: {
              reservation: "confirmed",
              payment: "paid",
              fulfillment: "fulfilled",
            },
            customer: dotyposCustomerId,
            at,
            overrides: {
              dotyposReservationId,
              activePaymentAttemptId: paymentAttemptId,
              reservationPurpose: billing.purpose,
            },
          });
          const snapshot = makeAccountingDocumentSnapshot({
            workspaceReservationId: reservation.id,
            dotyposReservationId,
            dotyposCustomerId,
            locale: "en-US",
            prepared,
          });
          yield* db.insert(paymentAttempts).values({
            id: paymentAttemptId,
            workspaceReservationId: reservation.id,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(
              `synthetic-order-${randomUUID()}`
            ),
            state: "paid",
            amountValue: snapshot.quote.payment.expectedPrice.value,
            amountExponent: snapshot.quote.payment.expectedPrice.exponent,
            currency: snapshot.quote.payment.expectedPrice.currency,
          });
          yield* recordAccountingDocumentSnapshot({
            paymentAttemptId,
            snapshot,
          }).pipe(
            Effect.provide(
              testAccountingStorage(testDatabase!.layer, keysLayer)
            )
          );
          return reservation.id;
        })
      )
    ).pipe(Effect.provide(testDatabase!.layer))
  );

  return { reservationId, paymentAttemptId, dotyposCustomerId };
};

/**
 * Dotypos as far as issuance writes it: the billing details each customer
 * holds, after `awaitWrite` lets each PATCH through.
 */
const makeDotypos = (
  awaitWrite: (call: number) => Effect.Effect<void> = () => Effect.void
) => {
  const billing = new Map<DotyposCustomerId, DotyposCustomerBillingDetails>();
  let calls = 0;
  const updateCustomerBillingDetails = mock(
    (customerId: DotyposCustomerId, details: DotyposCustomerBillingDetails) => {
      calls += 1;
      return awaitWrite(calls).pipe(
        Effect.andThen(
          Effect.sync(() => {
            billing.set(customerId, details);
          })
        )
      );
    }
  );
  return { billing, updateCustomerBillingDetails };
};

const runService = <A, E>(
  operation: (service: IReservationInvoiceService) => Effect.Effect<A, E>,
  dotypos: ReturnType<typeof makeDotypos>,
  deliver: ReturnType<typeof makeDelivery>
) =>
  Effect.runPromise(
    ReservationInvoiceService.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        ReservationInvoiceService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              testAccountingStorage(testDatabase!.layer, keysLayer),
              WorkspaceReservationRepository.Default.pipe(
                Layer.provide(testDatabase!.layer)
              ),
              Layer.mock(DotyposService, {
                updateCustomerBillingDetails:
                  dotypos.updateCustomerBillingDetails,
              }),
              Layer.mock(InvoiceEmailDeliveryService, deliver)
            )
          )
        )
      )
    )
  );

const makeDelivery = () => ({
  deliverByPaymentAttemptId: mock(() =>
    Effect.succeed({ status: "delivered" as const, changed: true })
  ),
  resendCustomerByPaymentAttemptId: mock(() =>
    Effect.succeed({ status: "delivered" as const, changed: true })
  ),
});

const readInvoices = (reservationId: WorkspaceReservationId) =>
  Effect.runPromise(
    testDatabase!.db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(eq(invoices.workspaceReservationId, reservationId))
  );

const readCounters = () =>
  Effect.runPromise(
    testDatabase!.db
      .select()
      .from(invoiceNumberCounters)
      .orderBy(asc(invoiceNumberCounters.numberingYear))
  ).then((rows) => rows.reduce((total, row) => total + row.lastSequence, 0));

const readIssuedBuyer = (paymentAttemptId: string) =>
  Effect.runPromise(
    InvoiceRepository.pipe(
      Effect.flatMap((repository) =>
        repository.findLiveByPaymentAttemptId(paymentAttemptId)
      ),
      Effect.map((invoice) => invoice?.document.buyer),
      Effect.provide(testAccountingStorage(testDatabase!.layer, keysLayer))
    )
  );

describe.skipIf(!testDatabase)(
  "reservation invoice issuance against Postgres",
  () => {
    test("issues the frozen buyer's invoice after fulfillment, once across retries", async () => {
      const fixture = await createFulfilledReservation({
        purpose: "personal",
        invoice: "requested",
        address: frozenAddress,
      });
      const dotypos = makeDotypos();
      const deliver = makeDelivery();
      const countersBefore = await readCounters();
      const issueAfterFulfillment = () =>
        runService(
          (service) =>
            service.issueAfterFulfillment({
              reservationId: fixture.reservationId,
            }),
          dotypos,
          deliver
        );

      await issueAfterFulfillment();
      await issueAfterFulfillment();

      const frozenBuyer = {
        kind: "person" as const,
        legalName: customerName,
        address: frozenAddress,
      };
      expect(await readInvoices(fixture.reservationId)).toHaveLength(1);
      expect(await readCounters()).toBe(countersBefore + 1);
      expect(await readIssuedBuyer(fixture.paymentAttemptId)).toEqual(
        frozenBuyer
      );
      // The retry found the invoice: Dotypos was written once, delivery retried.
      expect(dotypos.updateCustomerBillingDetails).toHaveBeenCalledTimes(1);
      expect(dotypos.billing.get(fixture.dotyposCustomerId)).toEqual(
        toDotyposCustomerBillingDetails(frozenBuyer)
      );
      expect(deliver.deliverByPaymentAttemptId).toHaveBeenCalledTimes(2);
    });

    test("issues a post-order invoice to the submitted address", async () => {
      const fixture = await createFulfilledReservation({
        purpose: "personal",
        invoice: "none",
      });
      const accessToken = await Effect.runPromise(
        createReservationAccessToken({
          orderId: fixture.reservationId,
          locale: "en-US",
        })
      );
      const dotypos = makeDotypos();
      const deliver = makeDelivery();
      const access = {
        orderId: fixture.reservationId,
        locale: "en-US" as const,
        accessToken,
      };

      const before = await runService(
        (service) => service.getPostOrderState(access),
        dotypos,
        deliver
      );
      const result = await runService(
        (service) =>
          service.createPostOrderInvoice({ ...access, address: firstAddress }),
        dotypos,
        deliver
      );
      const after = await runService(
        (service) => service.getPostOrderState(access),
        dotypos,
        deliver
      );

      const submittedBuyer = {
        kind: "person" as const,
        legalName: customerName,
        address: firstAddress,
      };
      expect([before, result, after]).toEqual([
        "create",
        { status: "created", delivered: true },
        "issued",
      ]);
      expect(await readIssuedBuyer(fixture.paymentAttemptId)).toEqual(
        submittedBuyer
      );
      expect(dotypos.billing.get(fixture.dotyposCustomerId)).toEqual(
        toDotyposCustomerBillingDetails(submittedBuyer)
      );
      expect(deliver.deliverByPaymentAttemptId).toHaveBeenCalledTimes(1);
    });

    test("leaves Dotypos holding the committed buyer when two post-order requests race", async () => {
      const fixture = await createFulfilledReservation({
        purpose: "personal",
        invoice: "none",
      });
      const accessToken = await Effect.runPromise(
        createReservationAccessToken({
          orderId: fixture.reservationId,
          locale: "en-US",
        })
      );
      // Both requests must pass the invoice lookup before either issues:
      // hold each first PATCH until both have arrived.
      const bothArrived = await Effect.runPromise(Deferred.make<void>());
      const arrivals = await Effect.runPromise(Ref.make(0));
      const dotypos = makeDotypos((call) =>
        call > 2
          ? Effect.void
          : Ref.updateAndGet(arrivals, (count) => count + 1).pipe(
              Effect.tap((count) =>
                count === 2
                  ? Deferred.succeed(bothArrived, undefined)
                  : Effect.void
              ),
              Effect.andThen(Deferred.await(bothArrived))
            )
      );
      const deliver = makeDelivery();
      const countersBefore = await readCounters();

      const results = await runService(
        (service) =>
          Effect.all(
            [firstAddress, secondAddress].map((address) =>
              service.createPostOrderInvoice({
                orderId: fixture.reservationId,
                locale: "en-US",
                accessToken,
                address,
              })
            ),
            { concurrency: "unbounded" }
          ),
        dotypos,
        deliver
      );

      const committed = await readIssuedBuyer(fixture.paymentAttemptId);
      expect(results.map((result) => result.status).sort()).toEqual([
        "already-issued",
        "created",
      ]);
      expect(await readInvoices(fixture.reservationId)).toHaveLength(1);
      expect(await readCounters()).toBe(countersBefore + 1);
      // Two submissions, then the loser's reconciliation to the winner.
      expect(dotypos.updateCustomerBillingDetails).toHaveBeenCalledTimes(3);
      expect(committed).toBeDefined();
      expect(dotypos.billing.get(fixture.dotyposCustomerId)).toEqual(
        committed && toDotyposCustomerBillingDetails(committed)
      );
      expect(deliver.deliverByPaymentAttemptId).toHaveBeenCalledTimes(2);
    });
  }
);
