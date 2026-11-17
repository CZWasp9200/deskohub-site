import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { AccountingSnapshotKeyError } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceCancellationService } from "@/features/accounting/backend/invoice-cancellation.service";
import { makeInvoiceCancellationTestKit } from "@/features/accounting/backend/invoice-cancellation.test-utils";
import { InvoiceCancellationNotices } from "@/features/accounting/backend/invoice-cancellation-notices";
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
