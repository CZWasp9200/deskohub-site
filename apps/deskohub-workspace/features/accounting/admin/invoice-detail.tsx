"use client";

import { Download, FileX, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { AdministrationAlert } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { retryAdministrationInvoice } from "./actions";
import type {
  InvoiceAdministrationCancellation,
  InvoiceAdministrationDetail,
  InvoiceAdministrationListItem,
} from "./invoice-administration.service";
import { InvoiceArchive } from "./invoice-archive";
import { InvoiceCancellation } from "./invoice-cancellation-dialog";

function InvoicePaymentStatusBadge({
  status,
}: {
  readonly status: InvoiceAdministrationDetail["paymentStatus"];
}) {
  const locale = useRouteLocale();
  return (
    <StatusBadge
      tone={
        {
          paid: "positive",
          issued: "neutral",
          due: "attention",
          overdue: "attention",
        }[status] as "positive" | "neutral" | "attention"
      }
    >
      {{
        paid: m.accountingInvoicePaymentPaid,
        issued: m.accountingInvoicePaymentIssued,
        due: m.accountingInvoicePaymentDue,
        overdue: m.accountingInvoicePaymentOverdue,
      }[status]({}, { locale })}
    </StatusBadge>
  );
}

/** The payment status, and beside it whether the invoice was cancelled. */
export function InvoiceStatusBadges({
  invoice,
}: {
  readonly invoice: Pick<
    InvoiceAdministrationListItem,
    "paymentStatus" | "cancellation"
  >;
}) {
  const locale = useRouteLocale();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <InvoicePaymentStatusBadge status={invoice.paymentStatus} />
      {invoice.cancellation && (
        <StatusBadge tone="neutral">
          <FileX aria-hidden className="size-3.5" />{" "}
          {m.accountingInvoiceCancelledBadge({}, { locale })}
        </StatusBadge>
      )}
    </span>
  );
}

export function InvoiceDetailActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationDetail;
}) {
  const locale = useRouteLocale();
  const [notice, setNotice] = useState<string | null>(null);
  const retry = useInvoiceRetry(
    m.accountingInvoiceRetryDeliveryError({}, { locale })
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a download href={localizeAdministrationHref(invoice.pdfUrl, locale)}>
            <Download aria-hidden className="size-4" />{" "}
            {m.accountingInvoiceDownloadPdf({}, { locale })}
          </a>
        </Button>
        {/* A cancelled invoice's retry resends its cancellation notices, in its cancellation panel. */}
        {!invoice.cancellation && invoice.needsAttention && (
          <Button
            disabled={retry.isExecuting}
            onClick={() => retry.execute(invoice.id)}
            type="button"
          >
            <RotateCw aria-hidden className="size-4" />{" "}
            {retry.isExecuting
              ? m.accountingInvoiceRetryingDelivery({}, { locale })
              : m.accountingInvoiceRetryDelivery({}, { locale })}
          </Button>
        )}
        {!invoice.cancellation && (
          <InvoiceCancellation
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            onCancelled={setNotice}
            placement="detail"
          />
        )}
      </div>
      <div role="status">
        {notice && (
          <AdministrationAlert status="success">{notice}</AdministrationAlert>
        )}
      </div>
      <div role="alert">
        {retry.error && (
          <AdministrationAlert status="error">
            {retry.error}
          </AdministrationAlert>
        )}
      </div>
    </div>
  );
}

/**
 * Retries what the invoice still owes: the original email for a live
 * invoice, the cancellation notices for a cancelled one.
 */
function useInvoiceRetry(failureMessage: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    retryAdministrationInvoice,
    {
      onSuccess: () => {
        setError(null);
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(actionError.serverError ?? failureMessage),
      onTransportError: () => setError(failureMessage),
    }
  );
  return {
    error,
    execute: (invoiceId: InvoiceAdministrationDetail["id"]) => {
      setError(null);
      execute({ invoiceId });
    },
    isExecuting,
  };
}

/**
 * A cancelled invoice's notices to the customer and to accounting, the retry
 * while one needs attention, and hiding the invoice from the Admin UI.
 */
export function InvoiceCancellationActions({
  invoice,
}: {
  readonly invoice: Pick<
    InvoiceAdministrationDetail,
    "id" | "invoiceNumber"
  > & {
    readonly cancellation: InvoiceAdministrationCancellation;
  };
}) {
  const locale = useRouteLocale();
  const retry = useInvoiceRetry(
    m.accountingInvoiceCancellationNoticesRetryError({}, { locale })
  );
  const { notices } = invoice.cancellation;
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        {(["customer", "internal"] as const).map((audience) => (
          <div
            className="rounded-xl border border-navy-blue/10 p-4"
            key={audience}
          >
            <dt className="text-sm text-navy-blue/60">
              {{
                customer: m.accountingInvoiceDeliveryAudienceCustomer,
                internal: m.accountingInvoiceDeliveryAudienceInternal,
              }[audience]({}, { locale })}
            </dt>
            <dd className="mt-2">
              <StatusBadge
                tone={
                  {
                    accepted: "positive",
                    failed: "attention",
                    not_owed: "neutral",
                    processing: "neutral",
                  }[notices[audience]] as "positive" | "attention" | "neutral"
                }
              >
                {{
                  accepted: m.accountingInvoiceDeliveryStatusAccepted,
                  failed: m.accountingInvoiceDeliveryStatusFailed,
                  not_owed: m.accountingInvoiceCancellationNoticeNotOwed,
                  processing: m.accountingInvoiceDeliveryStatusProcessing,
                }[notices[audience]]({}, { locale })}
              </StatusBadge>
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {notices.needsAttention && (
          <Button
            disabled={retry.isExecuting}
            onClick={() => retry.execute(invoice.id)}
            type="button"
          >
            <RotateCw aria-hidden className="size-4" />{" "}
            {retry.isExecuting
              ? m.accountingInvoiceRetryingDelivery({}, { locale })
              : m.accountingInvoiceCancellationNoticesRetry({}, { locale })}
          </Button>
        )}
        <InvoiceArchive
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          placement="detail"
        />
      </div>
      <div role="alert">
        {retry.error && (
          <AdministrationAlert status="error">
            {retry.error}
          </AdministrationAlert>
        )}
      </div>
    </div>
  );
}

export function InvoiceDeliverySummary({
  delivery,
}: {
  readonly delivery: InvoiceAdministrationDetail["delivery"];
}) {
  const locale = useRouteLocale();
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {(["customer", "internal"] as const).map((audience) => (
        <div
          className="rounded-xl border border-navy-blue/10 p-4"
          key={audience}
        >
          <dt className="text-sm text-navy-blue/60">
            {{
              customer: m.accountingInvoiceDeliveryAudienceCustomer,
              internal: m.accountingInvoiceDeliveryAudienceInternal,
            }[audience]({}, { locale })}
          </dt>
          <dd className="mt-2">
            <StatusBadge
              tone={
                {
                  accepted: "positive",
                  failed: "attention",
                  missing: "neutral",
                  processing: "neutral",
                }[delivery[audience]] as "positive" | "attention" | "neutral"
              }
            >
              {{
                accepted: m.accountingInvoiceDeliveryStatusAccepted,
                failed: m.accountingInvoiceDeliveryStatusFailed,
                missing: m.accountingInvoiceDeliveryStatusMissing,
                processing: m.accountingInvoiceDeliveryStatusProcessing,
              }[delivery[audience]]({}, { locale })}
            </StatusBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
