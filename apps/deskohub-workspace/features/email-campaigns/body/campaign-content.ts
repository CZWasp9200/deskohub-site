import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { CampaignBodyDocument } from "./campaign-body-document";

/**
 * Marketing campaigns need marketing consent and carry an unsubscribe link.
 * Operational campaigns announce service changes and carry a reason line.
 */
export const CampaignPurpose = Schema.Literals(["marketing", "operational"]);
export type CampaignPurpose = typeof CampaignPurpose.Type;

/** Keys of the code-defined campaign email templates. */
export const CampaignTemplateKey = Schema.Literals(["workspace"]);
export type CampaignTemplateKey = typeof CampaignTemplateKey.Type;

export const CampaignLocaleContent = Schema.Struct({
  subject: Schema.String,
  preheader: Schema.String,
  body: CampaignBodyDocument,
  /**
   * Replaces the fixed reason line in an operational campaign's footer.
   * Marketing campaigns ignore it.
   */
  operationalReason: Schema.optionalKey(
    Schema.Trimmed.check(Schema.isNonEmpty())
  ),
});
export type CampaignLocaleContent = typeof CampaignLocaleContent.Type;

/** Per-locale campaign texts; a locale without content is absent. */
export const CampaignLocalizedContent = Schema.Record(
  Schema.Literals(locales),
  Schema.optionalKey(CampaignLocaleContent)
);
export type CampaignLocalizedContent = typeof CampaignLocalizedContent.Type;

/** Everything a campaign email renders from. */
export const CampaignContent = Schema.Struct({
  purpose: CampaignPurpose,
  templateKey: CampaignTemplateKey,
  locales: CampaignLocalizedContent,
});
export type CampaignContent = typeof CampaignContent.Type;
