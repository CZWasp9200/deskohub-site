import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AudienceFilter } from "@/features/email-campaigns/audience-filter";
import {
  type CampaignLocalizedContent,
  type CampaignPurpose,
  CampaignPurpose as CampaignPurposeSchema,
  type CampaignTemplateKey,
} from "@/features/email-campaigns/body/campaign-content";
import type { CampaignContentHash } from "@/features/email-campaigns/body/campaign-content-hash";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "@/features/email-campaigns/campaign-identifiers";
import {
  type CampaignRecipientStatus,
  type CampaignStatus,
  campaignRecipientStatuses,
  campaignStatuses,
} from "@/features/email-campaigns/campaign-states";
import type { Locale } from "@/features/i18n";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";

export const emailCampaignAudiences = pgTable(
  "email_campaign_audiences",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<CampaignAudienceId>(),
    title: text("title").notNull(),
    filter: jsonb("filter").$type<AudienceFilter>().notNull(),
    archivedAt: instant("archived_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check("email_campaign_audiences_title_check", sql`btrim(${t.title}) <> ''`),
  ]
);

export type CampaignAudienceRow = typeof emailCampaignAudiences.$inferSelect;

export const emailCampaigns = pgTable(
  "email_campaigns",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<CampaignId>(),
    title: text("title").notNull(),
    purpose: text("purpose").notNull().$type<CampaignPurpose>(),
    // Templates live in code, so the service validates the key on write
    // instead of a check constraint that each new template would migrate.
    templateKey: text("template_key").notNull().$type<CampaignTemplateKey>(),
    content: jsonb("content")
      .$type<CampaignLocalizedContent>()
      .notNull()
      .default({}),
    // A sent campaign keeps its audience snapshot on the send, so deleting
    // an audience only detaches it.
    audienceId: text("audience_id")
      .references(() => emailCampaignAudiences.id, { onDelete: "set null" })
      .$type<CampaignAudienceId>(),
    status: text("status").notNull().default("draft").$type<CampaignStatus>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("email_campaigns_audience_idx").on(t.audienceId),
    check("email_campaigns_title_check", sql`btrim(${t.title}) <> ''`),
    check(
      "email_campaigns_purpose_check",
      sql`${t.purpose} in (${quotedSqlList(CampaignPurposeSchema.literals)})`
    ),
    check(
      "email_campaigns_status_check",
      sql`${t.status} in (${quotedSqlList(campaignStatuses)})`
    ),
  ]
);

export type CampaignRow = typeof emailCampaigns.$inferSelect;

/** The one send of a campaign, with the audience filter it was resolved by. */
export const emailCampaignSends = pgTable(
  "email_campaign_sends",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<CampaignSendId>(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id)
      .$type<CampaignId>(),
    audienceId: text("audience_id")
      .references(() => emailCampaignAudiences.id, { onDelete: "set null" })
      .$type<CampaignAudienceId>(),
    audienceFilter: jsonb("audience_filter").$type<AudienceFilter>().notNull(),
    contentHash: text("content_hash").notNull().$type<CampaignContentHash>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    completedAt: instant("completed_at"),
  },
  (t) => [
    uniqueIndex("email_campaign_sends_campaign_unique_idx").on(t.campaignId),
  ]
);

export type CampaignSendRow = typeof emailCampaignSends.$inferSelect;

/**
 * The recipients frozen at send time. The email address is re-read from
 * Dotypos at delivery, so a later consent withdrawal or address change wins.
 */
export const emailCampaignRecipients = pgTable(
  "email_campaign_recipients",
  {
    sendId: text("send_id")
      .notNull()
      .references(() => emailCampaignSends.id, { onDelete: "cascade" })
      .$type<CampaignSendId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    locale: text("locale").notNull().$type<Locale>(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<CampaignRecipientStatus>(),
    providerMessageId: text("provider_message_id"),
    statusUpdatedAt: instant("status_updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.sendId, t.dotyposCustomerId] }),
    uniqueIndex("email_campaign_recipients_provider_message_unique_idx").on(
      t.providerMessageId
    ),
    check(
      "email_campaign_recipients_locale_check",
      sql`${t.locale} in (${quotedSqlList(inlangSettings.locales)})`
    ),
    check(
      "email_campaign_recipients_status_check",
      sql`${t.status} in (${quotedSqlList(campaignRecipientStatuses)})`
    ),
  ]
);

export type CampaignRecipientRow = typeof emailCampaignRecipients.$inferSelect;

/**
 * Codes delivered in campaign test emails. A code confirms the real send only
 * while it is the campaign's latest code, unexpired, unconfirmed, and bound to
 * the campaign's current content hash.
 */
export const emailCampaignConfirmationCodes = pgTable(
  "email_campaign_confirmation_codes",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" })
      .$type<CampaignId>(),
    code: text("code").notNull(),
    contentHash: text("content_hash").notNull().$type<CampaignContentHash>(),
    issuedAt: instant("issued_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    supersededAt: instant("superseded_at"),
    confirmedAt: instant("confirmed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.code] }),
    uniqueIndex("email_campaign_confirmation_codes_current_unique_idx")
      .on(t.campaignId)
      .where(sql`${t.supersededAt} is null`),
    check(
      "email_campaign_confirmation_codes_expiry_check",
      sql`${t.expiresAt} > ${t.issuedAt}`
    ),
  ]
);
