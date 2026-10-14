import "server-only";

import { Effect } from "effect";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { campaignBodyFormatVersion } from "../../body/campaign-body-document";
import type { CampaignLocaleContent } from "../../body/campaign-content";
import { campaignTemplates } from "../../body/campaign-templates";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../../body/render-campaign-email";
import { loadAudienceOptions } from "../audiences/audience-page-data.server";
import { CampaignSendPipeline } from "../campaign-send-pipeline";
import type { CampaignComposerTemplate } from "./campaign-composer";

/** Placeholder content that shows a template's typography and footer. */
const templateSampleContent: CampaignLocaleContent = {
  subject: "Sample campaign",
  preheader: "How this template looks with typical content.",
  body: {
    formatVersion: campaignBodyFormatVersion,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "A heading for your news" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Paragraph text with " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
            { type: "text", text: " words, and " },
            {
              type: "text",
              text: "a link",
              marks: [{ type: "link", attrs: { href: "https://deskohub.cz" } }],
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "bulletList",
          content: ["First point", "Second point"].map((text) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        {
          type: "ctaButton",
          attrs: { label: "Call to action", href: "https://deskohub.cz" },
        },
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "A closing line after a divider." }],
        },
      ],
    },
  },
};

const loadTemplates = Effect.forEach(
  Object.values(campaignTemplates),
  (template) =>
    renderCampaignEmail({
      templateKey: template.key,
      locale: "en-US",
      content: templateSampleContent,
      footer: CampaignEmailFooter.Marketing({
        marketingPreferencesUrl: "https://deskohub.cz",
      }),
    }).pipe(
      Effect.map(
        ({ html }): CampaignComposerTemplate => ({
          key: template.key,
          name: template.name,
          description: template.description,
          previewHtml: html,
        })
      )
    )
);

const loadComposerOptions = () =>
  Effect.all(
    {
      templates: loadTemplates,
      adminInbox: Effect.gen(function* () {
        return (yield* CampaignSendPipeline).adminInbox;
      }),
    },
    { concurrency: "unbounded" }
  ).pipe(
    Effect.provide(CampaignSendPipeline.Live),
    runWorkspaceEffect("email-campaigns.admin.load-composer", {
      boundary: "route",
    })
  );

/** Audiences, templates, and the test inbox the composer offers. */
export const loadCampaignComposerOptions = async () => {
  await authorizeAdministratorPage();
  const [audiences, options] = await Promise.all([
    loadAudienceOptions(),
    loadComposerOptions(),
  ]);
  return { audiences, ...options };
};
