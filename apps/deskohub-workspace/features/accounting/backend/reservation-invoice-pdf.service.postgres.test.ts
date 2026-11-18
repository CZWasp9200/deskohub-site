import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { paymentAttempts } from "@/db/schema";
import {
  accountingSnapshotKeyIdSchema,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceBuyer } from "@/features/accounting/invoice";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { extractPdfText } from "@/shared/testing/pdf-text.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { recordAccountingDocumentSnapshot } from "./accounting-document-snapshots.test-utils";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { AccountingStorage } from "./accounting-storage";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceCancellationRepository } from "./invoice-cancellation.repository";
import { ReservationInvoicePdfService } from "./reservation-invoice-pdf.service";

// The suite issues reservation invoices of its own and cancels them; issued
// invoices and corrective documents are immutable, so it owns its database.
const postgres = await createWorkspacePostgresSuiteDatabase(
  "reservation_invoice_pdf"
);
afterAll(() => postgres?.close());

const coworkOrder = {
  entryTier: "open-space",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;
const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: "Synthetic Order Customer",
    email: testEmailAddress("reservation-invoice-pdf"),
    phone: "+420 700 000 000",
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote;
const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202611"),
  secret: "synthetic reservation invoice secret!",
};
const buyer = {
  kind: "person",
  legalName: "Synthetic Order Customer",
  address: {
    line1: "Synthetic 1",
    city: "Praha",
    postalCode: "100 00",
    country: "CZ",
  },
} satisfies InvoiceBuyer;

describe.skipIf(!postgres)(
  "ReservationInvoicePdfService on disposable Postgres",
  () => {
    // Built only inside tests: registration runs even when the suite is
    // skipped without a database.
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | AccountingDocumentSnapshots
        | WorkspaceDatabase
        | InvoiceRepository
        | InvoiceCancellationRepository
        | WorkspaceReservationRepository
      >
    ) => {
      const storage = Layer.merge(
        postgres!.layer,
        Layer.succeed(
          AccountingSnapshotKeyService,
          AccountingSnapshotKeyService.of({
            getActive: Effect.succeed(testKey),
            getById: () => Effect.succeed(testKey),
          })
        )
      );
      return Effect.runPromise(
        effect.pipe(
          Effect.provide(
            Layer.mergeAll(
              AccountingStorage.Default,
              WorkspaceReservationRepository.Default
            ).pipe(Layer.provideMerge(storage))
          )
        )
      );
    };

    /** A paid, fulfilled reservation with its payment's accounting snapshot. */
    const createPaidReservation = () => {
      const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `reservation-invoice-pdf-customer-${randomUUID()}`
      );
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `synthetic-reservation-${randomUUID()}`
      );
      return run(
        Effect.gen(function* () {
          const { db, transaction } = yield* WorkspaceDatabase;
          const reservationId = yield* transaction(
            Effect.gen(function* () {
              const reservation = yield* workspaceFixtures(db).reservation({
                stage: {
                  reservation: "confirmed",
                  payment: "paid",
                  fulfillment: "fulfilled",
                },
                customer: dotyposCustomerId,
                at: Temporal.Now.instant().round("millisecond"),
                overrides: {
                  dotyposReservationId,
                  activePaymentAttemptId: paymentAttemptId,
                },
              });
              const source = makeAccountingDocumentSnapshot({
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
                amountValue: source.quote.payment.expectedPrice.value,
                amountExponent: source.quote.payment.expectedPrice.exponent,
                currency: source.quote.payment.expectedPrice.currency,
              });
              yield* recordAccountingDocumentSnapshot({
                paymentAttemptId,
                snapshot: source,
              });
              return reservation.id;
            })
          );
          return { paymentAttemptId, reservationId };
        })
      );
    };

    const issue = (paymentAttemptId: PaymentAttemptId) =>
      run(
        Effect.flatMap(InvoiceRepository, (invoices) =>
          invoices.issue({ paymentAttemptId, buyer })
        )
      );

    /** Cancels the invoice the way an administrator's cancellation records it. */
    const cancel = (
      invoiceId: Awaited<ReturnType<typeof issue>>["invoice"]["id"]
    ) =>
      run(
        Effect.gen(function* () {
          const { db, transaction } = yield* WorkspaceDatabase;
          const administrator = yield* workspaceFixtures(db).account(
            "reservation-invoice-pdf-canceller"
          );
          const cancellations = yield* InvoiceCancellationRepository;
          return yield* transaction(
            cancellations.record({
              invoiceId,
              cause: "reservation_cancellation",
              actor: { source: "admin-ui", administrator },
              confirmedCustomerNotice: false,
            })
          );
        })
      );

    /** The order's invoice as the customer API serves it, authorized. */
    const getPdf = (orderId: WorkspaceReservationId) =>
      run(
        Effect.flatMap(ReservationInvoicePdfService, (service) =>
          service.getPdf({ orderId, locale: "en-US" })
        ).pipe(
          Effect.result,
          Effect.provide(
            ReservationInvoicePdfService.Default.pipe(
              Layer.provide(
                Layer.mock(ReservationAuthorizationService, {
                  authorize: () => Effect.succeed(true),
                })
              )
            )
          )
        )
      );

    const pdfText = async (orderId: WorkspaceReservationId) => {
      const result = await getPdf(orderId);
      if (result._tag !== "Success") throw new Error(String(result.failure));
      return {
        fileName: result.success.fileName,
        text: (await extractPdfText(result.success.bytes)).text,
      };
    };

    test("serves only the live invoice: not issued once it is cancelled, then its replacement", async () => {
      const { paymentAttemptId, reservationId } = await createPaidReservation();
      const original = await issue(paymentAttemptId);
      expect((await pdfText(reservationId)).fileName).toBe(
        `${original.invoice.invoiceNumber}.pdf`
      );

      await cancel(original.invoice.id);
      const cancelled = await getPdf(reservationId);
      expect(cancelled._tag === "Failure" && cancelled.failure).toMatchObject({
        _tag: "ReservationInvoiceNotIssuedError",
        orderId: reservationId,
      });

      const replacement = await issue(paymentAttemptId);
      const served = await pdfText(reservationId);
      expect(replacement.invoice.id).not.toBe(original.invoice.id);
      expect(served.fileName).toBe(`${replacement.invoice.invoiceNumber}.pdf`);
      expect(served.text).toContain(replacement.invoice.invoiceNumber);
      expect(served.text).not.toContain(original.invoice.invoiceNumber);
    });
  }
);
