"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
  EmptyState,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import type { AudienceListItem } from "./audience-page-data.server";

export const audienceHref = (audienceId: string) =>
  `/admin/email-audiences/${audienceId}`;

export function AudienceStatusBadge({
  archived,
}: {
  readonly archived: boolean;
}) {
  return (
    <Badge variant={archived ? "subtle" : "default"}>
      {archived ? "Archived" : "Active"}
    </Badge>
  );
}

export function AudienceList({
  audiences,
}: {
  readonly audiences: readonly AudienceListItem[];
}) {
  const router = useRouter();
  const columns = useMemo<AdministrationDataTableColumn<AudienceListItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Audience",
        cell: ({ row }) => (
          <Link
            className={cn(
              "font-semibold underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue",
              row.original.archived && "text-navy-blue/55"
            )}
            href={audienceHref(row.original.id)}
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "summary",
        header: "Who it reaches",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className={cn(
              "line-clamp-2 max-w-xl text-sm",
              row.original.archived ? "text-navy-blue/50" : "text-navy-blue/80"
            )}
          >
            {row.original.summary}
          </span>
        ),
      },
      {
        accessorKey: "archived",
        header: "Status",
        cell: ({ row }) => (
          <AudienceStatusBadge archived={row.original.archived} />
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-navy-blue/70 text-sm">
            {formatAdministrationDateTime(row.original.updatedAt)}
          </span>
        ),
      },
    ],
    []
  );

  if (audiences.length === 0) {
    return (
      <EmptyState message="No audiences yet. Create one to choose who a campaign reaches." />
    );
  }

  return (
    <AdministrationDataTable
      ariaLabel="Email audiences"
      columns={columns}
      data={audiences}
      getRowId={(audience) => audience.id}
      onRowActivate={(audience) => router.push(audienceHref(audience.id))}
    />
  );
}
