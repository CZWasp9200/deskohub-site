import { randomUUID } from "node:crypto";
import { testEmailAddress } from "@deskohub/test-email";

/**
 * One run's synthetic recipient-preview fixture. The tag is unique to the
 * run, so the audience matches exactly the one tagged synthetic customer
 * however many consenting customers the preview database already holds.
 */
export interface EmailCampaignPreviewPlan {
  readonly audienceTitle: string;
  readonly body: string;
  readonly campaignTitle: string;
  readonly customerFirstName: string;
  readonly customerTag: string;
  readonly recipientEmail: string;
  readonly subject: string;
}

export const planEmailCampaignPreview = (
  key: string = randomUUID().replaceAll("-", "").slice(0, 16)
): EmailCampaignPreviewPlan => ({
  audienceTitle: `Workspace E2E audience ${key}`,
  body: `Synthetic Workspace E2E campaign body ${key}.`,
  campaignTitle: `Workspace E2E campaign ${key}`,
  customerFirstName: "Workspace E2E campaign",
  customerTag: `e2e-campaign-${key}`,
  recipientEmail: testEmailAddress(`delivered+campaign-${key}`),
  subject: `Workspace E2E ${key}`,
});
