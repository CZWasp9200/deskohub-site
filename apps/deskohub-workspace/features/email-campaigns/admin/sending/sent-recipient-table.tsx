"use client";

import Link from "next/link";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import type { Locale } from "@/features/i18n";
import type { CampaignRecipientStatus } from "../../campaign-states";
import { CampaignRecipientStatusBadge } from "../campaign-list/campaign-badges";
import { campaignLocaleNames } from "./campaign-locale-names";

export type SentRecipientRow = {
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
  /** ISO instant. */
  readonly statusUpdatedAt: string;
};

const columns: AdministrationDataTableColumn<SentRecipientRow>[] = [
  {
    accessorKey: "dotyposCustomerId",
    header: "Customer",
    cell: ({ row }) => (
      <Link
        className="font-mono underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
        href={`/admin/customers/${row.original.dotyposCustomerId}`}
      >
        {row.original.dotyposCustomerId}
      </Link>
    ),
  },
  {
    accessorFn: (recipient) => campaignLocaleNames[recipient.locale],
    id: "locale",
    header: "Language",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <CampaignRecipientStatusBadge status={row.original.status} />
    ),
  },
  {
    accessorKey: "statusUpdatedAt",
    header: "Status since",
    cell: ({ row }) => formatAdministrationDateTime(row.original.statusUpdatedAt),
  },
];

export function SentRecipientTable({
  recipients,
}: {
  readonly recipients: readonly SentRecipientRow[];
}) {
  if (recipients.length === 0) {
    return <EmptyState message="This send froze no recipients." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Campaign recipients"
      columns={columns}
      data={recipients}
      getRowId={(recipient) => recipient.dotyposCustomerId}
    />
  );
}
