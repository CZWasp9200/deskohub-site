import { Badge } from "@/shared/components/ui/badge";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import type { CampaignPurpose } from "../../body/campaign-content";
import type {
  CampaignRecipientStatus,
  CampaignStatus,
} from "../../campaign-states";

export function CampaignStatusBadge({
  status,
}: {
  readonly status: CampaignStatus;
}) {
  return (
    <StatusBadge
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
      {{ draft: "Draft", sending: "Sending", sent: "Sent", failed: "Failed" }[
        status
      ]}
    </StatusBadge>
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
    <StatusBadge
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
    </StatusBadge>
  );
}
