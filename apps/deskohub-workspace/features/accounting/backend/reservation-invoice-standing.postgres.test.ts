import "@/shared/testing/workspace-test-env";
import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { InvoiceArchiveRepository } from "./invoice-archive.repository";
import { makeInvoiceCancellationTestKit } from "./invoice-cancellation.test-utils";
import { readReservationInvoiceStanding } from "./reservation-invoice-standing";

// The suite cancels invoices, so it owns its database.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "reservation_invoice_standing"
);
afterAll(() => testDatabase?.close());

const kit = makeInvoiceCancellationTestKit(testDatabase!);

const readStanding = (reservationId: WorkspaceReservationId) =>
  kit.run(
    Effect.flatMap(WorkspaceDatabase, ({ db }) =>
      readReservationInvoiceStanding(db, reservationId)
    )
  );

describe.skipIf(!testDatabase)(
  "readReservationInvoiceStanding on disposable Postgres",
  () => {
    test("follows the reservation's latest invoice through sending, cancelling and archiving", async () => {
      const actor = await kit.makeActor("standing");
      const paid = await kit.createPaidReservation();

      const before = await readStanding(paid.reservation.id);
      const { invoice } = await Effect.runPromise(paid.issueInvoice());
      const issued = await readStanding(paid.reservation.id);
      await kit.run(kit.acceptInvoiceEmail(invoice.id, "customer"));
      const sent = await readStanding(paid.reservation.id);
      await kit.run(
        kit.cancel({
          invoiceId: invoice.id,
          actor,
          confirmedCustomerNotice: true,
        })
      );
      const cancelled = await readStanding(paid.reservation.id);
      await kit.run(
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.archive({ invoiceId: invoice.id, actor })
        )
      );
      const archived = await readStanding(paid.reservation.id);
      const { invoice: replacement } = await Effect.runPromise(
        paid.issueInvoice()
      );
      const reissued = await readStanding(paid.reservation.id);

      expect(before).toBeNull();
      expect(issued).toEqual({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        state: "live",
        cancellationCause: null,
        archived: false,
        customerNotice: "not_owed",
      });
      expect(sent).toMatchObject({ state: "live", customerNotice: "owed" });
      // An administrator cancelled the invoice on its own.
      expect(cancelled).toMatchObject({
        id: invoice.id,
        state: "cancelled",
        cancellationCause: "invoice_cancellation",
      });
      expect(archived).toMatchObject({ id: invoice.id, archived: true });
      expect(reissued).toEqual({
        id: replacement.id,
        invoiceNumber: replacement.invoiceNumber,
        state: "live",
        cancellationCause: null,
        archived: false,
        customerNotice: "not_owed",
      });
    });
  }
);
