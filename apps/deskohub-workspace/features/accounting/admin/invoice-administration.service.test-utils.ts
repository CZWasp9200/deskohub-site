import { Effect, Layer } from "effect";
import type { InvoiceCancellationRecord } from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
import { InvoiceArchiveRepository } from "../backend/invoice-archive.repository";
import { InvoiceCancellationRepository } from "../backend/invoice-cancellation.repository";
import { InvoiceCancellationService } from "../backend/invoice-cancellation.service";

/** What a live invoice carries for cancellation, archive and replacement. */
export const liveInvoiceStanding = {
  cancellation: null,
  archivedAt: null,
  replacesInvoiceId: null,
  replacedByInvoiceId: null,
} as const;

/**
 * The cancellation dependencies of `InvoiceAdministrationService` for suites
 * about other operations: every invoice is live and bills no reservation.
 */
export const liveInvoiceCancellationFakes = Layer.mergeAll(
  Layer.mock(InvoiceCancellationService, {
    plan: (id) =>
      Effect.succeed({
        invoice: {
          id,
          invoiceNumber: "WS-FV-2026-000001" as never,
          reservationId: null,
          cancelled: false,
        },
        customerNotice: "not_owed",
        reservation: "none",
      }),
  }),
  Layer.mock(InvoiceCancellationRepository, {
    find: () => Effect.succeed(null),
    findMany: () =>
      Effect.succeed(new Map<InvoiceId, InvoiceCancellationRecord>()),
  }),
  Layer.mock(InvoiceArchiveRepository, {}),
  Layer.mock(ReservationAdministrationService, {})
);
