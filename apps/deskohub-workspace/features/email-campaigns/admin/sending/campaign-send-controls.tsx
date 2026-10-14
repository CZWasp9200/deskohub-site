"use client";

import type { Locale } from "@/features/i18n";
import type { CampaignId } from "../../campaign-identifiers";

export type CampaignSendControlsProps = {
  readonly campaignId: CampaignId;
  /** The fixed test-send recipient, from `CampaignSendPipeline.adminInbox`. */
  readonly adminInbox: string;
  /** Locales the saved campaign has content for. */
  readonly contentLocales: readonly Locale[];
  /** The composer has edits the test send would not include yet. */
  readonly unsavedChanges: boolean;
};

/**
 * Placeholder: the sending stream replaces this module with the recipient
 * preview link, the test-send dialog, and the code-confirmed send dialog.
 */
export function CampaignSendControls(_props: CampaignSendControlsProps) {
  return null;
}
