"use client";

import Link from "next/link";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { campaignLocaleNames } from "./campaign-locale-names";
import type { CampaignRecipientResolution } from "./recipient-preview.server";

type Recipient = CampaignRecipientResolution["recipients"][number];
type Exclusion = CampaignRecipientResolution["exclusions"][number];
type Duplicate = CampaignRecipientResolution["duplicates"][number];

function CustomerLink({ customerId }: { readonly customerId: string }) {
  return (
    <Link
      className="font-mono underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
      href={`/admin/customers/${customerId}`}
    >
      {customerId}
    </Link>
  );
}

const recipientColumns: AdministrationDataTableColumn<Recipient>[] = [
  { accessorKey: "email", header: "Email" },
  {
    accessorFn: (recipient) => campaignLocaleNames[recipient.locale],
    id: "locale",
    header: "Language",
  },
  {
    accessorKey: "dotyposCustomerId",
    header: "Customer",
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.dotyposCustomerId} />
    ),
  },
];

const exclusionReasons: Record<Exclusion["reason"], string> = {
  "missing-from-dotypos": "Not found in Dotypos",
  "deleted-customer": "Deleted in Dotypos",
  "missing-email": "No email in Dotypos",
  "invalid-email": "Invalid email in Dotypos",
};

const exclusionColumns: AdministrationDataTableColumn<Exclusion>[] = [
  {
    accessorKey: "dotyposCustomerId",
    header: "Customer",
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.dotyposCustomerId} />
    ),
  },
  {
    accessorFn: (exclusion) => exclusionReasons[exclusion.reason],
    id: "reason",
    header: "Reason",
  },
];

const duplicateColumns: AdministrationDataTableColumn<Duplicate>[] = [
  { accessorKey: "email", header: "Email" },
  {
    accessorKey: "recipientCustomerId",
    header: "Receives the email",
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.recipientCustomerId} />
    ),
  },
  {
    accessorFn: (duplicate) => duplicate.duplicateCustomerIds.join(", "),
    id: "skipped",
    header: "Skipped",
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-x-3">
        {row.original.duplicateCustomerIds.map((customerId) => (
          <CustomerLink customerId={customerId} key={customerId} />
        ))}
      </span>
    ),
  },
];

export function RecipientTable({
  recipients,
}: {
  readonly recipients: CampaignRecipientResolution["recipients"];
}) {
  if (recipients.length === 0) {
    return <EmptyState message="The audience reaches no customers right now." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Recipients"
      columns={recipientColumns}
      data={recipients}
      getRowId={(recipient) => recipient.dotyposCustomerId}
    />
  );
}

export function ExclusionTable({
  exclusions,
}: {
  readonly exclusions: CampaignRecipientResolution["exclusions"];
}) {
  if (exclusions.length === 0) {
    return <EmptyState message="No matching customer was excluded." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Excluded customers"
      columns={exclusionColumns}
      data={exclusions}
      getRowId={(exclusion) => exclusion.dotyposCustomerId}
    />
  );
}

export function DuplicateTable({
  duplicates,
}: {
  readonly duplicates: CampaignRecipientResolution["duplicates"];
}) {
  if (duplicates.length === 0) {
    return <EmptyState message="No two customers share an email address." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Shared email addresses"
      columns={duplicateColumns}
      data={duplicates}
      getRowId={(duplicate) => duplicate.email}
    />
  );
}
