import type { AdministrationWorkspaceReservationIdType } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { InvoiceCancellationError } from "@/features/accounting/invoice-cancellation";
import { AdministrationService } from "@/features/administration/administration.service";
import { formatAdministrationReservationDate } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { getAdministrationReservationProductTitle } from "@/features/administration/reservation-product";
import type { Locale } from "@/features/i18n";
import {
  type InvoiceAdministrationCancellationPlan,
  InvoiceAdministrationService,
} from "./invoice-administration.service";

/** The reservation cancelled with the invoice. */
type InvoiceCancellationReservation = {
  readonly reservationId: AdministrationWorkspaceReservationIdType;
  /** The reservation's product and date, worded for the operator. */
  readonly label: string;
};

/**
 * What the cancel confirmation shows: the warnings for a live invoice, or
 * that the invoice was cancelled meanwhile.
 */
export type InvoiceCancellationPreview =
  | { readonly state: "cancelled" }
  | {
      readonly state: "live";
      readonly invoiceNumber: string;
      readonly customerNotice: InvoiceAdministrationCancellationPlan["customerNotice"];
      /** Set when cancelling the invoice also cancels its reservation. */
      readonly reservation: InvoiceCancellationReservation | null;
    };

/**
 * Reads the invoice's cancellation plan as the Admin UI sees it (a hidden
 * invoice is not found) and, when it cancels the reservation too, the
 * reservation facts its cancellation confirms.
 */
export const readInvoiceCancellationPreview = Effect.fn(
  "InvoiceAdministration.readCancellationPreview"
)(function* (invoiceId: string, locale: Locale) {
  const invoices = yield* InvoiceAdministrationService;
  const invoice = yield* invoices.get(invoiceId, { includeArchived: false });
  const plan = invoice.cancellationPlan;
  if (!plan) return { state: "cancelled" } satisfies InvoiceCancellationPreview;
  const reservation =
    plan.reservation === "cancels_reservation" && invoice.reservationId
      ? yield* readCancelledReservation(invoice.reservationId, locale)
      : null;
  return {
    state: "live",
    invoiceNumber: invoice.invoiceNumber,
    customerNotice: plan.customerNotice,
    reservation,
  } satisfies InvoiceCancellationPreview;
});

const readCancelledReservation = Effect.fn(
  "InvoiceAdministration.readCancelledReservation"
)(function* (
  reservationId: AdministrationWorkspaceReservationIdType,
  locale: Locale
) {
  const administration = yield* AdministrationService;
  const detail = yield* administration.loadReservation(reservationId);
  // The plan reads a missing reservation as already cancelled, so this is a
  // reservation removed between the two reads.
  if (!detail) {
    return yield* new InvoiceCancellationError({
      code: "not_found",
      invoiceId: null,
      message: "The invoice's reservation was not found.",
    });
  }
  const product = getAdministrationReservationProductTitle(
    detail.reservation.product,
    locale
  );
  const date = formatAdministrationReservationDate(detail.reservation, locale);
  return {
    reservationId,
    label: date
      ? m.accountingInvoiceCancelReservationLabel({ product, date }, { locale })
      : product,
  } satisfies InvoiceCancellationReservation;
});
