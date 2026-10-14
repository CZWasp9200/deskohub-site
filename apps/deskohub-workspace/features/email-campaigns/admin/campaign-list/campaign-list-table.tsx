"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { CampaignPurposeBadge, CampaignStatusBadge } from "./campaign-badges";
import type { CampaignListItem } from "./campaign-list-page-data.server";

const columns: AdministrationDataTableColumn<CampaignListItem>[] = [
  {
    accessorKey: "title",
    header: "Campaign",
    cell: ({ row }) => (
      <Link
        className="font-semibold underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
        href={`/admin/email-campaigns/${row.original.id}`}
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: "purpose",
    header: "Purpose",
    cell: ({ row }) => <CampaignPurposeBadge purpose={row.original.purpose} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <CampaignStatusBadge status={row.original.status} />,
  },
  {
    accessorFn: (campaign) => campaign.audienceTitle ?? "",
    id: "audience",
    header: "Audience",
    cell: ({ row }) =>
      row.original.audienceTitle ?? (
        <span className="text-navy-blue/55">No audience</span>
      ),
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => formatAdministrationDateTime(row.original.updatedAt),
  },
];

export function CampaignListTable({
  campaigns,
}: {
  readonly campaigns: readonly CampaignListItem[];
}) {
  const router = useRouter();
  if (campaigns.length === 0) {
    return (
      <EmptyState message="No campaigns yet. Create one to compose your first email." />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel="Email campaigns"
      columns={columns}
      data={campaigns}
      getRowId={(campaign) => campaign.id}
      onRowActivate={(campaign) =>
        router.push(`/admin/email-campaigns/${campaign.id}`)
      }
    />
  );
}
