import { Badge } from "@/shared/components/ui/badge";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";
import type { CampaignPurpose } from "../../body/campaign-content";
import type {
  CampaignRecipientStatus,
  CampaignStatus,
} from "../../campaign-states";

// The shared progress tone pairs a yellow fill with navy text; campaign pills
// keep every tone's text in its own colour family.
function CampaignStatusPill({
  children,
  tone,
}: {
  readonly children: string;
  readonly tone: StatusTone;
}) {
  return (
    <StatusBadge
      className={tone === "progress" ? "text-sunset-yellow-ink" : undefined}
      tone={tone}
    >
      {children}
    </StatusBadge>
  );
}

export function CampaignStatusBadge({
  status,
}: {
  readonly status: CampaignStatus;
}) {
  return (
    <CampaignStatusPill
      tone={
        (
          {
            draft: "neutral",
            sending: "progress",
            sent: "positive",
            failed: "attention",
          } as const
        )[status]
      }
    >
      {
        { draft: "Draft", sending: "Sending", sent: "Sent", failed: "Failed" }[
          status
        ]
      }
    </CampaignStatusPill>
  );
}

export function CampaignPurposeBadge({
  purpose,
}: {
  readonly purpose: CampaignPurpose;
}) {
  return (
    <Badge variant={purpose === "marketing" ? "default" : "subtle"}>
      {{ marketing: "Marketing", operational: "Operational" }[purpose]}
    </Badge>
  );
}

export function CampaignRecipientStatusBadge({
  status,
}: {
  readonly status: CampaignRecipientStatus;
}) {
  return (
    <CampaignStatusPill
      tone={
        (
          {
            pending: "neutral",
            sent: "progress",
            delivered: "positive",
            bounced: "attention",
            complained: "attention",
            failed: "attention",
            skipped: "neutral",
          } as const
        )[status]
      }
    >
      {
        {
          pending: "Pending",
          sent: "Sent",
          delivered: "Delivered",
          bounced: "Bounced",
          complained: "Complained",
          failed: "Failed",
          skipped: "Skipped",
        }[status]
      }
    </CampaignStatusPill>
  );
}
