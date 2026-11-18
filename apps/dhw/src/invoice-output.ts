import type {
  AdministrationInvoiceArchiveResultType,
  AdministrationInvoiceCancellationInputType,
  AdministrationInvoiceCancellationPlanType,
  AdministrationInvoiceCancellationResultType,
  AdministrationInvoiceCancellationType,
  AdministrationInvoiceListItemType,
  AdministrationInvoiceNoticesType,
  AdministrationInvoiceRetryResultType,
  AdministrationReservationCancellationResultType,
  AdministrationReservationDetailType,
  AdministrationReservationRestorationResultType,
} from "@deskohub/workspace-admin-api";

/**
 * What an invoice cancellation does beyond issuing the corrective document:
 * each one the operator is shown is one the request confirms.
 */
export type InvoiceCancellationConsequence =
  | "customer_notice"
  | "reservation_cancellation";

export type InvoiceCancellationFlags = {
  readonly sendCancellationEmail: boolean;
};

/**
 * Plans an invoice cancellation from the invoice's cancellation plan and, for
 * an invoice that cancels its reservation, the reservation's detail. The
 * prompt and the request come from the same consequences, so the request
 * confirms exactly what the prompt showed.
 */
export const planInvoiceCancellation = ({
  invoiceNumber,
  plan,
  reservation,
  flags,
}: {
  readonly invoiceNumber: string;
  readonly plan: AdministrationInvoiceCancellationPlanType;
  readonly reservation: AdministrationReservationDetailType | null;
  readonly flags: InvoiceCancellationFlags;
}): {
  readonly consequences: ReadonlyArray<InvoiceCancellationConsequence>;
  readonly input: AdministrationInvoiceCancellationInputType;
  readonly prompt: string;
} => {
  const consequences: InvoiceCancellationConsequence[] = [];
  if (plan.customerNotice === "owed") consequences.push("customer_notice");
  if (plan.reservation === "cancels_reservation" && reservation !== null)
    consequences.push("reservation_cancellation");

  const describe = (consequence: InvoiceCancellationConsequence) => {
    if (consequence === "customer_notice")
      return "The invoice was sent to the customer, so they will be emailed a cancellation notice with the credit note.";
    const summary = reservation!.reservation;
    return [
      `This also cancels reservation ${summary.id} (${[
        summary.date ?? summary.startsAt ?? "Unknown date",
        summary.typeLabel,
        summary.customer?.displayName ?? summary.customerId,
        summary.status.label,
      ].join(
        " · "
      )}) in Dotypos. Paid online payments will be marked as needing a refund; no refund is issued automatically.`,
      flags.sendCancellationEmail
        ? "The customer will be emailed that the reservation was cancelled."
        : "The customer won't be emailed that the reservation was cancelled.",
    ].join("\n");
  };

  return {
    consequences,
    input: {
      confirmedCustomerNotice: consequences.includes("customer_notice"),
      ...(consequences.includes("reservation_cancellation") && {
        reservation: {
          sendCancellationEmail: flags.sendCancellationEmail,
        },
      }),
    },
    prompt: [
      `Cancel invoice ${invoiceNumber}? A credit note will be issued for it, and Deskohub's accounting will be emailed a copy.`,
      ...consequences.map(describe),
    ].join("\n"),
  };
};

/**
 * The invoice consequence of cancelling a reservation, from its detail: a
 * live invoice is cancelled with it. The prompt lines and the confirmation
 * come from the same reading.
 */
export const planReservationInvoiceConsequences = (
  invoice: AdministrationReservationDetailType["invoice"]
) => {
  const live = invoice?.state === "live";
  const customerNotice = live && invoice?.customerNotice === "owed";
  return {
    confirmedConsequences: { invoice: live, customerNotice },
    lines: live
      ? [
          `Its invoice ${invoice.invoiceNumber} will be cancelled with a credit note.`,
          ...(customerNotice
            ? [
                "The invoice was sent to the customer, so they will be emailed a cancellation notice.",
              ]
            : []),
        ]
      : [],
  };
};

const noticeLabel = (state: AdministrationInvoiceNoticesType["customer"]) =>
  ({
    not_owed: "not owed",
    processing: "sending",
    accepted: "sent",
    failed: "failed",
  })[state] satisfies string;

export const formatInvoiceNotices = (
  notices: AdministrationInvoiceNoticesType
) =>
  `Cancellation notices: customer ${noticeLabel(notices.customer)} · internal ${noticeLabel(notices.internal)}`;

/** The invoice's standing for list rows: live, cancelled, or archived. */
export const getInvoiceStateLabel = (
  invoice: Pick<
    AdministrationInvoiceListItemType,
    "archivedAt" | "cancellation"
  >
) => {
  if (invoice.archivedAt !== null) return "Cancelled, archived";
  return invoice.cancellation === null ? "Live" : "Cancelled";
};

export const formatInvoiceCancellation = (
  cancellation: AdministrationInvoiceCancellationType
) =>
  [
    `Cancelled ${cancellation.cancelledAt} by ${cancellation.actor} via ${cancellation.source} (${cancellation.cause}) · credit note ${cancellation.correctiveDocumentNumber}`,
    formatInvoiceNotices(cancellation.notices),
  ].join("\n");

const retryHint = (
  invoiceId: string,
  notices: AdministrationInvoiceNoticesType
) =>
  notices.needsAttention
    ? [`A notice wasn't sent; retry it with dhw invoices resend ${invoiceId}.`]
    : [];

export const formatInvoiceCancellationOutput = (
  invoiceNumber: string,
  result: AdministrationInvoiceCancellationResultType
) => {
  const { cancellation, reservation } = result;
  return [
    result.outcome === "cancelled"
      ? `Cancelled invoice ${invoiceNumber} with credit note ${cancellation.correctiveDocumentNumber}.`
      : `Invoice ${invoiceNumber} was already cancelled with credit note ${cancellation.correctiveDocumentNumber}.`,
    ...(reservation === null
      ? []
      : [
          `Reservation ${reservation.reservationId} ${reservation.outcome === "cancelled" ? "was cancelled with it" : "was already cancelled"}; ${
            {
              failed: "its cancellation email could not be sent.",
              not_requested: "the customer wasn't emailed about it.",
              sent: "the customer was emailed about it.",
            }[reservation.email]
          }`,
        ]),
    formatInvoiceNotices(cancellation.notices),
    ...retryHint(result.invoiceId, cancellation.notices),
  ].join("\n");
};

/** The invoice consequence of a reservation cancellation, for its output. */
export const formatReservationInvoiceOutput = (
  invoice: AdministrationReservationCancellationResultType["invoice"]
) =>
  invoice === null
    ? []
    : [
        invoice.outcome === "cancelled"
          ? `Invoice ${invoice.invoiceNumber} was cancelled with credit note ${invoice.correctiveDocumentNumber}.`
          : `Invoice ${invoice.invoiceNumber} was already cancelled with credit note ${invoice.correctiveDocumentNumber}.`,
        formatInvoiceNotices(invoice.notices),
        ...retryHint(invoice.invoiceId, invoice.notices),
      ];

/** What restoring the reservation does to its invoice, for the confirmation. */
export const planRestorationInvoiceConsequence = (
  restoration: AdministrationReservationDetailType["restoration"]
) =>
  restoration?.issuesNewInvoice === true
    ? [
        "Its invoice was cancelled with it, so a new invoice is issued and sent to the customer; the cancelled invoice and its credit note stay.",
      ]
    : [];

/** The new invoice a restore issued, for its output. */
export const formatRestorationInvoiceOutput = (
  invoice: AdministrationReservationRestorationResultType["invoice"]
) =>
  invoice === null
    ? []
    : [
        {
          issued: `New invoice ${invoice.invoiceNumber} was issued and sent.`,
          failed:
            invoice.invoiceNumber === null
              ? "The new invoice could not be issued; the restore stands and Workspace retries it."
              : `New invoice ${invoice.invoiceNumber} was issued but could not be sent; Workspace retries it.`,
          not_issued:
            "No new invoice was issued because the payment holds no invoice details.",
        }[invoice.outcome],
      ];

export const formatInvoiceArchiveOutput = (
  invoiceNumber: string,
  result: AdministrationInvoiceArchiveResultType
) =>
  result.changed
    ? `Archived invoice ${invoiceNumber}; it's hidden from the Admin UI and stays readable through dhw.`
    : `Invoice ${invoiceNumber} was already archived on ${result.archivedAt}.`;

export const formatInvoiceResendOutput = (
  result: AdministrationInvoiceRetryResultType
) => {
  if (result.notices === null)
    return result.changed
      ? `Retried delivery for invoice ${result.invoiceId}.`
      : `Invoice ${result.invoiceId} had no retryable delivery.`;
  return [
    result.changed
      ? `Retried the cancellation notices of invoice ${result.invoiceId}; the invoice email isn't sent again.`
      : `Invoice ${result.invoiceId} had no cancellation notice to retry.`,
    formatInvoiceNotices(result.notices),
  ].join("\n");
};
