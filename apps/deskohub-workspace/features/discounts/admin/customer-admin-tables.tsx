"use client";

import { useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import type { AdministrationCustomerTransaction } from "@/features/administration/administration.service";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
} from "@/features/administration/formatters";
import { NexiOrderLink } from "@/features/administration/nexi-order-link";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { CustomerCodeAction } from "./customer-admin-client";
import type {
  AdminCustomerProfile,
  AdminDiscountCodeClaim,
} from "./discount-administration.service";

type Money = AdminDiscountCodeClaim["appliedAmount"];

type CustomerPromotionCodeItem =
  | {
      readonly kind: "discount-code";
      readonly id: AdminCustomerProfile["codes"][number]["id"];
      readonly audienceSize: number;
      readonly code: string;
      readonly discountAdjustment: DiscountAdjustment;
      readonly discountLabel: string;
      readonly eligible: boolean;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "voucher";
      readonly id: AdminCustomerProfile["vouchers"][number]["id"];
      readonly audienceSize: number;
      readonly code: string;
      readonly eligible: boolean;
      readonly enabled: boolean;
      readonly issuedCredit: Money;
      readonly remainingCredit: Money;
    };

type ClaimHistoryItem = {
  readonly id: string;
  readonly appliedAmount: Money;
  readonly codeId?: string;
  readonly dotyposCustomerId: string;
  readonly redeemedAt: string | null;
  readonly releasedAt: string | null;
  readonly releaseReason: string | null;
  readonly reservedAt: string;
  readonly state: AdminDiscountCodeClaim["state"];
  readonly voucherId?: string;
  readonly workspaceReservationId: string;
};

const promotionCodeKindLabels = {
  "discount-code": "Discount code",
  voucher: "Voucher",
} satisfies Record<CustomerPromotionCodeItem["kind"], string>;

const getPromotionCodeHref = (item: CustomerPromotionCodeItem) =>
  item.kind === "voucher"
    ? `/admin/vouchers/${item.id}`
    : `/admin/codes/${item.id}`;

const getPromotionCodeBenefit = (item: CustomerPromotionCodeItem) => {
  if (item.kind === "voucher") {
    return `${formatAdministrationMoney(item.issuedCredit)} credit`;
  }
  return `${item.discountLabel} · ${
    item.discountAdjustment.kind === "percentage"
      ? `${item.discountAdjustment.basisPoints / 100}%`
      : formatAdministrationMoney(item.discountAdjustment.amount)
  }`;
};

const getPromotionCodeAvailability = (item: CustomerPromotionCodeItem) => {
  if (item.audienceSize === 0) return "Available to all";
  if (item.eligible && item.audienceSize === 1) return "Only this customer";
  return `${item.audienceSize} selected customers`;
};

export function CustomerPromotionCodeTable({
  customerId,
  customerName,
  items,
}: {
  readonly customerId: AdminCustomerProfile["customer"]["id"];
  readonly customerName: string;
  readonly items: readonly CustomerPromotionCodeItem[];
}) {
  const columns = useMemo<
    AdministrationDataTableColumn<CustomerPromotionCodeItem>[]
  >(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <Link
            className="font-mono font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
            href={getPromotionCodeHref(row.original)}
          >
            {row.original.code}
          </Link>
        ),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: (item) => promotionCodeKindLabels[item.kind],
        id: "type",
        header: "Type",
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: getPromotionCodeBenefit,
        id: "benefit",
        header: "Benefit",
        cell: ({ row }) => (
          <>
            {getPromotionCodeBenefit(row.original)}
            {row.original.kind === "voucher" && (
              <span className="mt-0.5 block text-xs text-navy-blue/65">
                {formatAdministrationMoney(row.original.remainingCredit)}{" "}
                remaining
              </span>
            )}
          </>
        ),
        meta: { cellClassName: "break-words" },
      },
      {
        accessorKey: "enabled",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge tone={row.original.enabled ? "positive" : "neutral"}>
            {row.original.enabled ? "Enabled" : "Disabled"}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: "Availability",
        cell: ({ row }) => getPromotionCodeAvailability(row.original),
      },
      {
        id: "action",
        header: () => <span className="sr-only">Manage eligibility</span>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.kind === "discount-code" && (
            <CustomerCodeAction
              audienceSize={row.original.audienceSize}
              code={row.original.code}
              codeId={row.original.id}
              customerId={customerId}
              customerName={customerName}
              eligible={row.original.eligible}
            />
          ),
        meta: { cellClassName: "relative z-10 text-right" },
      },
    ],
    [customerId, customerName]
  );

  return (
    <AdministrationDataTable
      ariaLabel="Customer codes and vouchers"
      columns={columns}
      data={items}
      getRowId={(item) => `${item.kind}:${item.id}`}
      tableClassName="min-w-[760px]"
    />
  );
}

export function CustomerTransactionHistoryTable({
  transactions,
}: {
  readonly transactions: readonly AdministrationCustomerTransaction[];
}) {
  const columns = useMemo<
    AdministrationDataTableColumn<AdministrationCustomerTransaction>[]
  >(
    () => [
      {
        accessorFn: ({ attempt }) => attempt.updatedAt,
        id: "date",
        header: "Date",
        cell: ({ row }) =>
          formatAdministrationDateTime(row.original.attempt.updatedAt),
        meta: {
          cellClassName: "whitespace-nowrap text-navy-blue/68",
        },
      },
      {
        accessorFn: ({ attempt }) => attempt.state,
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            tone={
              row.original.attempt.state === "paid" ? "positive" : "neutral"
            }
          >
            {row.original.attempt.stateLabel}
          </StatusBadge>
        ),
      },
      {
        accessorFn: ({ reservation }) => reservation.typeLabel,
        id: "reservation",
        header: "Reservation",
        cell: ({ row }) => (
          <Link
            className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
            href={`/admin/reservations/${row.original.reservation.id}`}
          >
            {row.original.reservation.typeLabel}
          </Link>
        ),
      },
      {
        accessorFn: ({ attempt }) => attempt.amount.value,
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.attempt.amount),
        meta: { cellClassName: "whitespace-nowrap font-semibold" },
      },
      {
        accessorFn: ({ attempt }) => attempt.providerOrderId ?? attempt.id,
        id: "paymentId",
        header: "Payment ID",
        cell: ({ row }) =>
          row.original.attempt.providerOrderId ? (
            <NexiOrderLink
              className="font-mono text-xs"
              orderId={row.original.attempt.providerOrderId}
            />
          ) : (
            <span className="font-mono text-xs">{row.original.attempt.id}</span>
          ),
      },
    ],
    []
  );

  return (
    <AdministrationDataTable
      ariaLabel="Customer transaction history"
      columns={columns}
      data={transactions}
      getRowId={({ attempt }) => attempt.id}
      tableClassName="min-w-[760px]"
    />
  );
}

export function ClaimHistoryTable({
  claims,
  resource,
}: {
  readonly claims: readonly ClaimHistoryItem[];
  readonly resource: "code" | "code-customer" | "voucher" | "voucher-customer";
}) {
  const isVoucher = resource.startsWith("voucher");
  const showsCustomer = resource.endsWith("customer");
  const subjectLabel = isVoucher ? "Voucher" : "Discount code";
  const columns = useMemo<AdministrationDataTableColumn<ClaimHistoryItem>[]>(
    () => [
      {
        accessorFn: (claim) =>
          showsCustomer
            ? claim.dotyposCustomerId
            : (claim.codeId ?? claim.voucherId),
        id: "subject",
        header: showsCustomer ? "Customer" : subjectLabel,
        cell: ({ row }) => (
          <Link
            className="font-semibold underline underline-offset-4"
            href={
              showsCustomer
                ? `/admin/customers/${row.original.dotyposCustomerId}`
                : getClaimSubjectHref(row.original)
            }
          >
            View {showsCustomer ? "customer" : resource}
          </Link>
        ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => (
          <>
            <StatusBadge
              tone={row.original.state === "released" ? "neutral" : "positive"}
            >
              {row.original.state[0]?.toUpperCase()}
              {row.original.state.slice(1)}
            </StatusBadge>
            {row.original.releaseReason && (
              <p className="mt-1 max-w-48 text-xs text-navy-blue/65">
                {row.original.releaseReason}
              </p>
            )}
          </>
        ),
      },
      {
        accessorFn: (claim) => claim.appliedAmount.value,
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.appliedAmount),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorKey: "reservedAt",
        header: "Reserved",
        cell: ({ row }) =>
          formatAdministrationDateTime(row.original.reservedAt),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: (claim) => claim.redeemedAt ?? claim.releasedAt ?? "",
        id: "completed",
        header: "Completed",
        cell: ({ row }) =>
          row.original.redeemedAt || row.original.releasedAt
            ? formatAdministrationDateTime(
                row.original.redeemedAt ?? row.original.releasedAt ?? ""
              )
            : "—",
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorKey: "workspaceReservationId",
        header: "Reservation",
        cell: ({ row }) => (
          <Link
            className="font-semibold underline underline-offset-4"
            href={`/admin/reservations/${row.original.workspaceReservationId}`}
          >
            Open reservation
          </Link>
        ),
      },
    ],
    [resource, showsCustomer, subjectLabel]
  );

  return (
    <AdministrationDataTable
      ariaLabel={`${subjectLabel} claim history`}
      columns={columns}
      data={claims}
      getRowId={(claim) => claim.id}
      tableClassName="min-w-[820px]"
    />
  );
}

const getClaimSubjectHref = (claim: ClaimHistoryItem) =>
  claim.codeId
    ? `/admin/codes/${claim.codeId}`
    : `/admin/vouchers/${claim.voucherId}`;
