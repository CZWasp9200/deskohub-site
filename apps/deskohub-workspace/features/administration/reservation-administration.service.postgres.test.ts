import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingSnapshotKeyError } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceCancellationService } from "@/features/accounting/backend/invoice-cancellation.service";
import { makeInvoiceCancellationTestKit } from "@/features/accounting/backend/invoice-cancellation.test-utils";
import { InvoiceCancellationNotices } from "@/features/accounting/backend/invoice-cancellation-notices";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { PaidFulfillmentQueueService } from "@/features/checkout/backend/fulfillment/paid-fulfillment-queue.service";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  ReservationAdministrationService,
  type ReservationCancellationInput,
} from "./reservation-administration.service";
import { ReservationRestorationService } from "./reservation-restoration.service";

const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "reservation_invoice_cancellation"
);
afterAll(() => testDatabase?.close());

const kit = makeInvoiceCancellationTestKit(testDatabase!);
const testKeyId = "K202611";
const missingKey = new AccountingSnapshotKeyError({
  keyId: testKeyId,
  message: "Synthetic key is unavailable.",
});
const readableKey = {
  id: testKeyId,
  secret: "synthetic corrective document secret!",
} as never;

/**
 * Reservation cancellation over the suite database: the real reservation
 * and invoice repositories, with Dotypos, the reservation email, the
 * provider reservation read and the notice email faked.
 */
const makeCancellation = (
  options: {
    readonly encryptionKeyFails?: boolean;
    readonly decryptionKeyFails?: boolean;
    /** Runs in the claim's transaction, just before the reservation is claimed. */
    readonly beforeClaim?: Effect.Effect<void>;
    /** Runs in the claim's transaction, after the claim, before it commits. */
    readonly afterClaim?: Effect.Effect<void>;
    /** Runs while Dotypos cancels, after the claim committed. */
    readonly duringProviderCancel?: Effect.Effect<void>;
  } = {}
) => {
  const repositories = kit.layer({
    getActive: options.encryptionKeyFails
      ? Effect.fail(missingKey)
      : Effect.succeed(readableKey),
    getById: () =>
      options.decryptionKeyFails
        ? Effect.fail(missingKey)
        : Effect.succeed(readableKey),
  });
  const deliver = mock(
    (_input: Parameters<InvoiceCancellationNotices["Service"]["deliver"]>[0]) =>
      Effect.succeed({
        changed: true,
        notices: {
          customer: "not_owed" as const,
          internal: "accepted" as const,
          needsAttention: false,
        },
      })
  );
  const cancelReservation = mock(
    () => options.duringProviderCancel ?? Effect.void
  );
  const reservations = Layer.effect(
    WorkspaceReservationRepository,
    Effect.map(WorkspaceReservationRepository, (real) => ({
      ...real,
      claimAdministrationCancellation: (
        input: Parameters<typeof real.claimAdministrationCancellation>[0]
      ) =>
        (options.beforeClaim ?? Effect.void).pipe(
          Effect.andThen(real.claimAdministrationCancellation(input)),
          Effect.tap(() => options.afterClaim ?? Effect.void)
        ),
    }))
  ).pipe(
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(repositories)
  );
  const invoiceCancellation = InvoiceCancellationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        repositories,
        Layer.mock(InvoiceCancellationNotices, { deliver })
      )
    )
  );
  const layer = ReservationAdministrationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        repositories,
        reservations,
        invoiceCancellation,
        Layer.mock(DotyposService, { cancelReservation }),
        Layer.mock(ReservationRestorationService, {}),
        Layer.mock(ReservationInvoiceService, {}),
        Layer.mock(PaidFulfillmentQueueService, {}),
        Layer.mock(WorkspaceReservationEmailService, {
          sendCancellationEmail: () => Effect.void,
        }),
        Layer.mock(WorkspaceReservationService, {
          getReservation: (id: WorkspaceReservationId) =>
            Effect.succeed({
              id,
              dotyposReservationId: "synthetic-dotypos",
              providerStatus: "CONFIRMED",
            } as never),
        })
      )
    )
  );
  const cancel = (input: ReservationCancellationInput) =>
    Effect.runPromise(
      ReservationAdministrationService.pipe(
        Effect.flatMap((service) => service.cancel(input)),
        Effect.provide(layer)
      )
    );
  const cancelFailure = (input: ReservationCancellationInput) =>
    Effect.runPromise(
      ReservationAdministrationService.pipe(
        Effect.flatMap((service) => Effect.flip(service.cancel(input))),
        Effect.provide(layer)
      )
    );
  return { cancel, cancelFailure, cancelReservation, deliver };
};

/**
 * Reservation restore over the suite database. The restore itself confirms
 * the reservation with the real repository write, as main's restore does in
 * its finalize transaction; issuance issues through the real invoice
 * repository and records each delivery.
 */
const makeRestoration = (
  options: { readonly issuanceFails?: boolean } = {}
) => {
  const repositories = kit.layer();
  const delivered = mock((_reservationId: WorkspaceReservationId) => {});
  const enqueue = mock(
    (
      _input: Parameters<PaidFulfillmentQueueService["Service"]["enqueue"]>[0]
    ) => Effect.void
  );
  const reservations = WorkspaceReservationRepository.Default.pipe(
    Layer.provide(repositories)
  );
  const restoration = Layer.effect(
    ReservationRestorationService,
    Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const { transaction } = yield* WorkspaceDatabase;
      return ReservationRestorationService.of({
        restore: ({ reservationId }) =>
          repository.findById(reservationId).pipe(
            Effect.flatMap((current) =>
              current?.reservationState === "cancelled" &&
              current.reservationCancelledAt
                ? transaction(
                    repository.markAdministrationRestored({
                      id: reservationId,
                      cancelledAt: current.reservationCancelledAt,
                      restoredAt: Temporal.Now.instant(),
                    })
                  ).pipe(Effect.as("restored" as const))
                : Effect.succeed("already_confirmed" as const)
            ),
            Effect.map((outcome) => ({
              outcome,
              email: "not_requested" as const,
              access: "not_needed" as const,
            })),
            Effect.orDie
          ),
      });
    })
  ).pipe(Layer.provide(Layer.merge(reservations, repositories)));
  // Paid fulfillment's issuance: the reservation's payment attempt issues
  // through the repository, then its invoice is sent.
  const reservationInvoices = Layer.effect(
    ReservationInvoiceService,
    Effect.gen(function* () {
      const invoices = yield* InvoiceRepository;
      const repository = yield* WorkspaceReservationRepository;
      return ReservationInvoiceService.of({
        issueAfterFulfillment: ({ reservationId }) =>
          options.issuanceFails
            ? // A typed failure, as Dotypos or the invoice repository fails.
              Effect.fail(new Error("Synthetic issuance failure.") as never)
            : repository.findById(reservationId).pipe(
                Effect.flatMap((reservation) =>
                  invoices.issue({
                    paymentAttemptId: reservation!.activePaymentAttemptId!,
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
                ),
                Effect.tap(() => Effect.sync(() => delivered(reservationId))),
                Effect.asVoid,
                Effect.orDie
              ),
      } as never);
    })
  ).pipe(Layer.provide(Layer.merge(reservations, repositories)));
  const layer = ReservationAdministrationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        repositories,
        reservations,
        restoration,
        reservationInvoices,
        Layer.mock(PaidFulfillmentQueueService, { enqueue }),
        Layer.mock(InvoiceCancellationService, {}),
        Layer.mock(DotyposService, {}),
        Layer.mock(WorkspaceReservationEmailService, {}),
        Layer.mock(WorkspaceReservationService, {})
      )
    )
  );
  const restore = (reservationId: WorkspaceReservationId) =>
    Effect.runPromise(
      ReservationAdministrationService.pipe(
        Effect.flatMap((service) =>
          service.restore({
            reservationId,
            acknowledgeRefundedPayment: false,
            sendRestorationEmail: false,
          })
        ),
        Effect.provide(layer)
      )
    );
  return { delivered, enqueue, restore };
};

const readInvoiceChain = (reservationId: string) =>
  kit.query<{
    id: string;
    invoice_number: string;
    replaces_invoice_id: string | null;
  }>(
    "select id, invoice_number, replaces_invoice_id from invoices where workspace_reservation_id = $1 order by issued_at, invoice_number",
    [reservationId]
  );

const readCreditNotes = (invoiceId: string) =>
  kit.query(
    "select * from corrective_documents where cancelled_invoice_id = $1",
    [invoiceId]
  );

const readState = async (reservationId: string, invoiceId?: string) => {
  const [reservation] = await kit.query<{ reservation_state: string }>(
    "select reservation_state from workspace_reservations where id = $1",
    [reservationId]
  );
  const cancellations = invoiceId
    ? await kit.query<{ cause: string; source: string }>(
        "select cause, source from invoice_cancellations where invoice_id = $1",
        [invoiceId]
      )
    : [];
  return {
    reservation: reservation?.reservation_state,
    cancellations,
  };
};

const cancellationInput = async (
  reservationId: WorkspaceReservationId,
  confirmedConsequences?: ReservationCancellationInput["confirmedConsequences"]
): Promise<ReservationCancellationInput> => ({
  actor: await kit.makeActor(`reservation-cancel-${reservationId}`),
  ...(confirmedConsequences && { confirmedConsequences }),
  reservationId,
  sendCancellationEmail: false,
});

describe.skipIf(!testDatabase)(
  "Reservation cancellation with its invoice on disposable Postgres",
  () => {
    test("cancels the reservation and its live invoice together, then sends the notices", async () => {
      const { invoice, reservation } = await kit.issueReservationInvoice();
      const { cancel, deliver } = makeCancellation();

      const result = await cancel(
        await cancellationInput(reservation.id, {
          invoice: true,
          customerNotice: false,
        })
      );

      expect(result).toMatchObject({
        outcome: "cancelled",
        invoice: {
          outcome: "cancelled",
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          correctiveDocumentNumber: expect.stringMatching(/^WS-OD-/),
        },
      });
      expect(await readState(reservation.id, invoice.id)).toEqual({
        reservation: "cancelled",
        cancellations: [
          { cause: "reservation_cancellation", source: "dhw-cli" },
        ],
      });
      // The reservation keeps its own record of why it was cancelled beside
      // the invoice's cancellation cause.
      const [reservationCause] = await kit.query<{
        cancellation_cause: string | null;
      }>(
        "select cancellation_cause from workspace_reservations where id = $1",
        [reservation.id]
      );
      expect(reservationCause?.cancellation_cause).toBe("operator");
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(deliver.mock.calls[0]![0].invoiceId).toBe(invoice.id);
    });

    test("a failed invoice cancellation rolls the reservation's completion back with it", async () => {
      const { invoice, reservation } = await kit.issueReservationInvoice();
      const { cancelFailure, cancelReservation, deliver } = makeCancellation({
        encryptionKeyFails: true,
      });

      const failure = await cancelFailure(
        await cancellationInput(reservation.id)
      );

      expect(failure.reason).toBe("record_failed");
      expect(cancelReservation).toHaveBeenCalledTimes(1);
      // Neither is cancelled; the claim is released for a retry.
      expect(await readState(reservation.id, invoice.id)).toEqual({
        reservation: "cancellation_failed",
        cancellations: [],
      });
      expect(deliver).not.toHaveBeenCalled();
    });

    test("an unreadable invoice stops the cancellation before the provider call", async () => {
      const { invoice, reservation } = await kit.issueReservationInvoice();
      const { cancelFailure, cancelReservation } = makeCancellation({
        decryptionKeyFails: true,
      });

      const failure = await cancelFailure(
        await cancellationInput(reservation.id)
      );

      expect(failure.reason).toBe("invoice_unavailable");
      expect(cancelReservation).not.toHaveBeenCalled();
      expect(await readState(reservation.id, invoice.id)).toEqual({
        reservation: "confirmed",
        cancellations: [],
      });
    });

    test("refuses consequences the operator did not confirm, before the provider call", async () => {
      const { invoice, reservation } = await kit.issueReservationInvoice();
      const { cancelFailure, cancelReservation } = makeCancellation();

      const failure = await cancelFailure(
        await cancellationInput(reservation.id, {
          invoice: false,
          customerNotice: false,
        })
      );

      expect(failure).toMatchObject({
        code: "not_cancellable",
        reason: "confirmation_stale",
      });
      expect(cancelReservation).not.toHaveBeenCalled();
      expect((await readState(reservation.id, invoice.id)).reservation).toBe(
        "confirmed"
      );
    });

    test("an invoice issued just before the claim refuses a cancellation confirmed without it", async () => {
      const paid = await kit.createPaidReservation();
      let issuedId: string | undefined;
      const { cancelFailure, cancelReservation } = makeCancellation({
        // Issued and committed on its own connection once the operator's
        // reservation read is done, as a concurrent fulfillment would.
        beforeClaim: Effect.promise(() =>
          Effect.runPromise(paid.issueInvoice())
        ).pipe(
          Effect.flatMap(({ invoice }) =>
            Effect.sync(() => {
              issuedId = invoice.id;
            })
          )
        ),
      });

      const failure = await cancelFailure(
        await cancellationInput(paid.reservation.id, {
          invoice: false,
          customerNotice: false,
        })
      );

      expect(failure).toMatchObject({
        code: "not_cancellable",
        reason: "confirmation_stale",
      });
      expect(cancelReservation).not.toHaveBeenCalled();
      expect(await readState(paid.reservation.id, issuedId)).toEqual({
        reservation: "confirmed",
        cancellations: [],
      });
    });

    test("an invoice issued while the claim is being checked waits for it and is refused", async () => {
      const paid = await kit.createPaidReservation();
      let issuance: Promise<unknown> | undefined;
      const { cancel } = makeCancellation({
        afterClaim: Effect.promise(async () => {
          issuance = Effect.runPromise(Effect.flip(paid.issueInvoice()));
          await waitForPostgresLockWaiter(testDatabase!.pool, {
            condition: "locktype = 'transactionid'",
            description: "the invoice issuance waiting for the claim",
          });
        }),
      });

      const result = await cancel(
        await cancellationInput(paid.reservation.id, {
          invoice: false,
          customerNotice: false,
        })
      );

      expect(result).toMatchObject({ outcome: "cancelled", invoice: null });
      expect(await issuance).toMatchObject({
        _tag: "InvoiceEligibilityError",
        reason: "reservation_cancelled",
      });
      expect(
        await kit.query(
          "select id from invoices where workspace_reservation_id = $1",
          [paid.reservation.id]
        )
      ).toEqual([]);
    });

    test("issuance refuses once the reservation's cancellation is claimed", async () => {
      const paid = await kit.createPaidReservation();
      let refusal: unknown;
      const { cancel } = makeCancellation({
        duringProviderCancel: Effect.flip(paid.issueInvoice()).pipe(
          Effect.flatMap((error) =>
            Effect.sync(() => {
              refusal = error;
            })
          ),
          Effect.orDie
        ),
      });

      const result = await cancel(await cancellationInput(paid.reservation.id));

      expect(refusal).toMatchObject({
        _tag: "InvoiceEligibilityError",
        reason: "reservation_cancelled",
      });
      expect(result).toMatchObject({ outcome: "cancelled", invoice: null });
    });

    test("an already cancelled reservation answers already_cancelled without touching its invoice", async () => {
      const { invoice, reservation } = await kit.issueReservationInvoice();
      const first = makeCancellation();
      await first.cancel(await cancellationInput(reservation.id));
      const replay = makeCancellation();

      const result = await replay.cancel(
        await cancellationInput(reservation.id)
      );

      expect(result).toEqual({
        outcome: "already_cancelled",
        email: "not_requested",
        invoice: null,
      });
      expect(replay.cancelReservation).not.toHaveBeenCalled();
      expect(
        (await readState(reservation.id, invoice.id)).cancellations
      ).toHaveLength(1);
    });
  }
);

describe.skipIf(!testDatabase)(
  "Reservation restore with its cancelled invoice on disposable Postgres",
  () => {
    const cancelWithInvoice = async () => {
      const issued = await kit.issueReservationInvoice();
      await makeCancellation().cancel(
        await cancellationInput(issued.reservation.id)
      );
      return issued;
    };

    test("issues and sends one replacement for the invoice cancelled with the reservation; its credit note stays", async () => {
      const { invoice, reservation } = await cancelWithInvoice();
      const creditNotes = await readCreditNotes(invoice.id);
      const { delivered, enqueue, restore } = makeRestoration();

      const result = await restore(reservation.id);

      const chain = await readInvoiceChain(reservation.id);
      expect(chain).toHaveLength(2);
      const replacement = chain.find(({ id }) => id !== invoice.id)!;
      expect(replacement.replaces_invoice_id).toBe(invoice.id);
      expect(replacement.invoice_number).not.toBe(invoice.invoiceNumber);
      expect(result).toEqual({
        outcome: "restored",
        email: "not_requested",
        access: "not_needed",
        invoice: {
          outcome: "issued",
          invoiceId: replacement.id,
          invoiceNumber: replacement.invoice_number,
        },
      });
      expect(delivered).toHaveBeenCalledTimes(1);
      expect(enqueue).not.toHaveBeenCalled();
      expect(await readCreditNotes(invoice.id)).toEqual(creditNotes);
      expect(
        (await readState(reservation.id, invoice.id)).cancellations
      ).toEqual([{ cause: "reservation_cancellation", source: "dhw-cli" }]);

      // A rerun finds the replacement live and issues nothing more.
      const rerun = await restore(reservation.id);
      expect(rerun).toMatchObject({
        outcome: "already_confirmed",
        invoice: null,
      });
      expect(await readInvoiceChain(reservation.id)).toHaveLength(2);
    });

    test("issues nothing for a reservation without an invoice, or whose invoice is still live", async () => {
      const unbilled = await kit.createPaidReservation();
      await makeCancellation().cancel(
        await cancellationInput(unbilled.reservation.id)
      );
      // Cancelled before invoices were cancelled with reservations: the
      // reservation is cancelled while its invoice stays live.
      const { invoice, reservation } = await kit.issueReservationInvoice();
      await kit.query(
        "update workspace_reservations set reservation_state = 'cancelled', reservation_cancelled_at = now(), cancellation_cause = 'operator' where id = $1",
        [reservation.id]
      );
      const { delivered, restore } = makeRestoration();

      expect(await restore(unbilled.reservation.id)).toMatchObject({
        outcome: "restored",
        invoice: null,
      });
      expect(await restore(reservation.id)).toMatchObject({
        outcome: "restored",
        invoice: null,
      });
      expect(delivered).not.toHaveBeenCalled();
      expect(await readInvoiceChain(unbilled.reservation.id)).toEqual([]);
      expect(
        (await readInvoiceChain(reservation.id)).map(({ id }) => id)
      ).toEqual([invoice.id]);
    });

    test("issues nothing for an invoice an administrator cancelled on its own", async () => {
      const { invoice, reservation } = await kit.issueReservationInvoice();
      await kit.run(
        kit.cancel({
          invoiceId: invoice.id,
          actor: await kit.makeActor(`invoice-cancel-${invoice.id}`),
        })
      );
      await makeCancellation().cancel(await cancellationInput(reservation.id));
      const { delivered, restore } = makeRestoration();

      expect(await restore(reservation.id)).toMatchObject({
        outcome: "restored",
        invoice: null,
      });
      expect(delivered).not.toHaveBeenCalled();
      expect(await readInvoiceChain(reservation.id)).toHaveLength(1);
    });

    test("a failed issuance keeps the restore and queues the replacement for the paid-fulfillment retry", async () => {
      const { invoice, reservation } = await cancelWithInvoice();
      const failing = makeRestoration({ issuanceFails: true });

      const result = await failing.restore(reservation.id);

      expect(result).toEqual({
        outcome: "restored",
        email: "not_requested",
        access: "not_needed",
        invoice: { outcome: "failed", invoiceId: null, invoiceNumber: null },
      });
      expect((await readState(reservation.id)).reservation).toBe("confirmed");
      expect(failing.enqueue.mock.calls).toEqual([
        [{ orderId: reservation.id, replacesInvoiceId: invoice.id }],
      ]);
      expect(await readInvoiceChain(reservation.id)).toHaveLength(1);

      // The replacement is still owed, so a rerun of the restore issues it.
      const retry = makeRestoration();
      expect(await retry.restore(reservation.id)).toMatchObject({
        outcome: "already_confirmed",
        invoice: { outcome: "issued" },
      });
      expect(retry.delivered).toHaveBeenCalledTimes(1);
      expect(await readInvoiceChain(reservation.id)).toHaveLength(2);
    });
  }
);
