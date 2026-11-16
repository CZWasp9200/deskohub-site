"use client";

import { CircleAlert, Download, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationAlert,
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { retryAdministrationInvoice } from "./actions";
import type {
  InvoiceAdministrationListItem,
  InvoiceAdministrationUnreadableListItem,
} from "./invoice-administration.service";
import { InvoiceArchive } from "./invoice-archive";
import { InvoiceCancellation } from "./invoice-cancellation-dialog";
import { InvoiceStatusBadges } from "./invoice-detail";
import { getInvoiceSourceLabel } from "./invoice-display";
import { isUnreadableInvoiceListEntry } from "./invoice-list-entry";
import { type InvoiceListQuery, invoiceListQuery } from "./invoice-list-query";

/**
 * A list item with its issue time and total already formatted on the server:
 * the client's ICU spaces date-times and amounts differently from Node's.
 */
export type InvoiceAdministrationTableRow =
  | (InvoiceAdministrationListItem & {
      readonly issuedAtLabel: string;
      readonly totalLabel: string;
    })
  | (InvoiceAdministrationUnreadableListItem & {
      readonly issuedAtLabel: string;
    });

/** The invoice's number, linking its detail page when its document can be read. */
function InvoiceNumber({
  className,
  invoice,
}: {
  readonly className: string;
  readonly invoice: InvoiceAdministrationTableRow;
}) {
  if (isUnreadableInvoiceListEntry(invoice)) {
    return <span className="font-semibold">{invoice.invoiceNumber}</span>;
  }
  return (
    <Link
      className={className}
      href={administrationHref("/[locale]/admin/invoices/[invoiceId]", {
        invoiceId: invoice.id,
      })}
    >
      {invoice.invoiceNumber}
    </Link>
  );
}

/**
 * Stands in for the customer, total, payment status, source and delivery of
 * an invoice whose document could not be read.
 */
function InvoiceDocumentUnavailable() {
  const locale = useRouteLocale();
  return (
    <span data-slot="invoice-document-unavailable">
      <StatusBadge tone="attention">
        <CircleAlert aria-hidden className="size-3.5" />{" "}
        {m.accountingInvoiceDocumentUnavailable({}, { locale })}
      </StatusBadge>
    </span>
  );
}

/** The status badges; an unreadable invoice shows only whether it is cancelled. */
function InvoiceRowStatus({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationTableRow;
}) {
  const locale = useRouteLocale();
  if (!isUnreadableInvoiceListEntry(invoice)) {
    return <InvoiceStatusBadges invoice={invoice} />;
  }
  return (
    invoice.cancelledAt && (
      <StatusBadge tone="neutral">
        {m.accountingInvoiceCancelledBadge({}, { locale })}
      </StatusBadge>
    )
  );
}

const getInvoiceColumns = (
  locale: Locale
): readonly AdministrationDataTableColumn<InvoiceAdministrationTableRow>[] => [
  {
    accessorKey: "invoiceNumber",
    header: m.accountingInvoiceColumnInvoice({}, { locale }),
    cell: ({ row }) => (
      <InvoiceNumber
        className="font-semibold underline underline-offset-4"
        invoice={row.original}
      />
    ),
  },
  {
    id: "customer",
    accessorFn: (invoice) =>
      isUnreadableInvoiceListEntry(invoice) ? null : invoice.customerName,
    header: m.accountingInvoiceColumnCustomer({}, { locale }),
    cell: ({ row }) =>
      isUnreadableInvoiceListEntry(row.original) ? (
        <InvoiceDocumentUnavailable />
      ) : (
        row.original.customerName
      ),
  },
  {
    accessorKey: "issuedAt",
    header: m.accountingInvoiceColumnIssued({}, { locale }),
    cell: ({ row }) => row.original.issuedAtLabel,
  },
  {
    id: "total",
    accessorFn: (invoice) =>
      isUnreadableInvoiceListEntry(invoice) ? null : invoice.total,
    header: m.accountingInvoiceColumnTotal({}, { locale }),
    cell: ({ row }) =>
      isUnreadableInvoiceListEntry(row.original)
        ? null
        : row.original.totalLabel,
    meta: { cellClassName: "font-mono tabular-nums" },
  },
  {
    id: "paymentStatus",
    accessorFn: (invoice) =>
      isUnreadableInvoiceListEntry(invoice) ? null : invoice.paymentStatus,
    header: m.accountingInvoiceColumnPayment({}, { locale }),
    cell: ({ row }) => <InvoiceRowStatus invoice={row.original} />,
  },
  {
    id: "source",
    accessorFn: (invoice) =>
      isUnreadableInvoiceListEntry(invoice) ? null : invoice.source,
    header: m.accountingInvoiceColumnProvenance({}, { locale }),
    cell: ({ row }) =>
      isUnreadableInvoiceListEntry(row.original) ? null : (
        <div>
          <p>{getInvoiceSourceLabel(row.original.source, locale)}</p>
          {row.original.actor && (
            <p className="text-xs text-navy-blue/55">{row.original.actor}</p>
          )}
        </div>
      ),
  },
  {
    id: "delivery",
    header: m.accountingInvoiceColumnDelivery({}, { locale }),
    accessorFn: (invoice) =>
      !isUnreadableInvoiceListEntry(invoice) && invoice.needsAttention,
    cell: ({ row }) =>
      isUnreadableInvoiceListEntry(row.original) ? null : (
        <InvoiceDeliveryBadge invoice={row.original} />
      ),
  },
];

/**
 * The invoice email's delivery, or a cancelled invoice's notices: its own
 * email no longer matters, and a notice not owed counts as delivered.
 */
function InvoiceDeliveryBadge({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationListItem;
}) {
  const locale = useRouteLocale();
  const { customer, internal } =
    invoice.cancellation?.notices ?? invoice.delivery;
  const delivered = (status: typeof customer) =>
    status === "accepted" || status === "not_owed";
  if (invoice.needsAttention) {
    return (
      <StatusBadge tone="attention">
        <CircleAlert aria-hidden className="size-3.5" />{" "}
        {m.accountingInvoiceDeliveryNeedsResend({}, { locale })}
      </StatusBadge>
    );
  }
  if (delivered(customer) && delivered(internal)) {
    return (
      <StatusBadge tone="positive">
        {m.accountingInvoiceDeliverySent({}, { locale })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral">
      {m.accountingInvoiceDeliverySending({}, { locale })}
    </StatusBadge>
  );
}

export function InvoiceAdministrationTable({
  items,
  query,
}: {
  readonly items: readonly InvoiceAdministrationTableRow[];
  readonly query: InvoiceListQuery;
}) {
  const locale = useRouteLocale();
  return (
    <AdministrationDataTable
      ariaLabel={m.accountingInvoiceTableLabel({}, { locale })}
      columns={getInvoiceColumns(locale)}
      data={items}
      getRowId={(item) => item.id}
      {...invoiceListQuery.tableSorting(query)}
      renderActions={(item) => <InvoiceRowActions invoice={item} />}
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {items.map((invoice) => (
            <li className="p-4" key={invoice.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <InvoiceNumber
                    className="font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                    invoice={invoice}
                  />
                  <p className="mt-1 truncate text-sm text-navy-blue/65">
                    {isUnreadableInvoiceListEntry(invoice) ? (
                      <InvoiceDocumentUnavailable />
                    ) : (
                      invoice.customerName
                    )}
                  </p>
                </div>
                <InvoiceRowStatus invoice={invoice} />
              </div>
              {!isUnreadableInvoiceListEntry(invoice) && (
                <p className="mt-3 font-mono text-sm font-semibold tabular-nums">
                  {invoice.totalLabel}
                </p>
              )}
              <p className="mt-1 text-xs text-navy-blue/60">
                {m.accountingInvoiceIssuedOn(
                  { issuedAt: invoice.issuedAtLabel },
                  { locale }
                )}
              </p>
              <div className="mt-3 flex items-start justify-between gap-3">
                {isUnreadableInvoiceListEntry(invoice) ? (
                  <span />
                ) : (
                  <InvoiceDeliveryBadge invoice={invoice} />
                )}
                <InvoiceRowActions invoice={invoice} />
              </div>
            </li>
          ))}
        </ul>
      }
      tableClassName="min-w-[1120px]"
    />
  );
}

function InvoiceRowActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationTableRow;
}) {
  if (!isUnreadableInvoiceListEntry(invoice)) {
    return <ReadableInvoiceRowActions invoice={invoice} />;
  }
  // Hiding needs no document; downloading, cancelling and retrying do.
  return (
    invoice.cancelledAt && (
      <div className="flex justify-end gap-1">
        <InvoiceArchive
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          placement="row"
        />
      </div>
    )
  );
}

function ReadableInvoiceRowActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationListItem;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    retryAdministrationInvoice,
    {
      onSuccess: () => {
        setError(null);
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            m.accountingInvoiceRetryDeliveryError({}, { locale })
        ),
      onTransportError: () =>
        setError(m.accountingInvoiceRetryDeliveryError({}, { locale })),
    }
  );
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex justify-end gap-1">
        <Button
          asChild
          aria-label={m.accountingInvoiceDownloadLabel(
            { invoiceNumber: invoice.invoiceNumber },
            { locale }
          )}
          size="icon"
          variant="ghost"
        >
          <a
            download
            href={getLocalizedPagePath(
              locale,
              "/[locale]/admin/invoices/[invoiceId]/pdf",
              { invoiceId: invoice.id }
            )}
          >
            <Download aria-hidden className="size-4" />
          </a>
        </Button>
        {invoice.needsAttention && (
          <Button
            aria-label={(invoice.cancellation
              ? m.accountingInvoiceCancellationNoticesRetryLabel
              : m.accountingInvoiceRetryDeliveryLabel)(
              { invoiceNumber: invoice.invoiceNumber },
              { locale }
            )}
            disabled={isExecuting}
            onClick={() => {
              setError(null);
              execute({ invoiceId: invoice.id });
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <RotateCw aria-hidden className="size-4" />
          </Button>
        )}
        {invoice.cancellation ? (
          <InvoiceArchive
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            placement="row"
          />
        ) : (
          <InvoiceCancellation
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            onCancelled={setNotice}
            placement="row"
          />
        )}
      </div>
      <div role="status">
        {notice && (
          <AdministrationAlert
            className="max-w-56 text-left text-xs"
            status="success"
          >
            {notice}
          </AdministrationAlert>
        )}
      </div>
      {error && (
        <AdministrationAlert
          className="max-w-56 text-left text-xs"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
    </div>
  );
}
