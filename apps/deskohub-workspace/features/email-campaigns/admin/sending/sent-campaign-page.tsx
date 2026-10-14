import type { CampaignRow } from "@/db/schema";

/** Placeholder: the sending stream replaces this module. */
export async function SentCampaignPage({
  campaign,
}: {
  readonly campaign: CampaignRow;
}) {
  return <p>Sent campaign {campaign.title}</p>;
}
