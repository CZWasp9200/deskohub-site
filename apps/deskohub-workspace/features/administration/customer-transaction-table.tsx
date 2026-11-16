"use client";

import { useMemo } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { AdministrationLink as Link } from "./admin-link";
import type { AdministrationCustomerTransaction } from "./administration.service";
import { administrationHref } from "./administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { getAdministrationPaymentStatus } from "./formatters";
import { m } from "./i18n";
import { NexiOrderLink } from "./nexi-order-link";
import { PaymentAmount } from "./payment-status";
import { getAdministrationReservationProductTitle } from "./reservation-product";

/** A transaction whose time arrives formatted from the server. */
export type CustomerTransactionTableItem = AdministrationCustomerTransaction & {
  readonly updatedAtLabel: string;
};

export function CustomerTransactionHistoryTable({
  transactions,
}: {
  readonly transactions: readonly CustomerTransactionTableItem[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo<
    AdministrationDataTableColumn<CustomerTransactionTableItem>[]
  >(
    () => [
      {
        accessorFn: ({ attempt }) => attempt.updatedAt,
        id: "date",
        header: m.administrationCustomerTransactionColumnDate({}, { locale }),
        cell: ({ row }) => row.original.updatedAtLabel,
        meta: {
          cellClassName: "whitespace-nowrap text-navy-blue/68",
        },
      },
      {
        accessorFn: ({ attempt }) => attempt.state,
        id: "status",
        header: m.administrationCustomerTransactionColumnStatus({}, { locale }),
        cell: ({ row }) => {
          const { attempt } = row.original;
          const status = getAdministrationPaymentStatus(attempt, locale);
          return (
            <StatusBadge
              tone={
                attempt.state === "paid" && !status.refunded
                  ? "positive"
                  : "neutral"
              }
            >
              {status.label}
            </StatusBadge>
          );
        },
      },
      {
        accessorFn: ({ reservation }) =>
          getAdministrationReservationProductTitle(reservation.product, locale),
        id: "reservation",
        header: m.administrationCustomerTransactionColumnReservation(
          {},
          { locale }
        ),
        cell: ({ row }) => (
          <Link
            className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
            href={administrationHref(
              "/[locale]/admin/reservations/[reservationId]",
              { reservationId: row.original.reservation.id }
            )}
          >
            {getAdministrationReservationProductTitle(
              row.original.reservation.product,
              locale
            )}
          </Link>
        ),
      },
      {
        accessorFn: ({ attempt }) => attempt.amount.value,
        id: "amount",
        header: m.administrationCustomerTransactionColumnAmount({}, { locale }),
        cell: ({ row }) => (
          <PaymentAmount locale={locale} payment={row.original.attempt} />
        ),
        meta: { cellClassName: "whitespace-nowrap font-semibold" },
      },
      {
        accessorFn: ({ attempt }) => attempt.providerOrderId ?? attempt.id,
        id: "paymentId",
        header: m.administrationCustomerTransactionColumnPaymentId(
          {},
          { locale }
        ),
        cell: ({ row }) =>
          row.original.attempt.providerOrderId ? (
            <NexiOrderLink
              className="font-mono text-xs"
              locale={locale}
              orderId={row.original.attempt.providerOrderId}
            />
          ) : (
            <span className="font-mono text-xs">{row.original.attempt.id}</span>
          ),
      },
    ],
    [locale]
  );

  return (
    <AdministrationDataTable
      ariaLabel={m.administrationCustomerProfileTransactionsTableLabel(
        {},
        { locale }
      )}
      columns={columns}
      data={transactions}
      getRowId={({ attempt }) => attempt.id}
      tableClassName="min-w-[760px]"
    />
  );
}
