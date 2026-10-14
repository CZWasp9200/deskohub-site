import type { CampaignRow } from "@/db/schema";

/** Placeholder: the composer stream replaces this module. */
export async function CampaignComposerPage({
  campaign,
}: {
  readonly campaign: CampaignRow;
}) {
  return <p>Composer for {campaign.title}</p>;
}
