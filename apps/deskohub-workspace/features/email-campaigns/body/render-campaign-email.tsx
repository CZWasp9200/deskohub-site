import { Data, Effect, Match } from "effect";
import { type Locale, m } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { CampaignBodyContent } from "./campaign-body-content";
import type {
  CampaignLocaleContent,
  CampaignTemplateKey,
} from "./campaign-content";
import {
  type CampaignTemplateProps,
  campaignTemplates,
} from "./campaign-templates";

/**
 * Why the recipient gets the email. A marketing email links to the customer's
 * marketing preferences, where they can unsubscribe; an operational email
 * states that it is a service message.
 */
export type CampaignEmailFooter = Data.TaggedEnum<{
  Marketing: { readonly marketingPreferencesUrl: string };
  Operational: Record<never, never>;
}>;

export const CampaignEmailFooter = Data.taggedEnum<CampaignEmailFooter>();

const footerProps = (
  footer: CampaignEmailFooter,
  locale: Locale
): CampaignTemplateProps["footer"] =>
  Match.valueTags(footer, {
    Marketing: ({ marketingPreferencesUrl }) => ({
      note: m.emailCampaignMarketingFooter({}, { locale }),
      link: {
        label: m.emailCampaignMarketingFooterLink({}, { locale }),
        href: marketingPreferencesUrl,
      },
    }),
    Operational: () => ({
      note: m.emailCampaignOperationalFooter({}, { locale }),
    }),
  });

/**
 * Renders one locale of a campaign inside its template, as HTML and plain
 * text.
 */
export const renderCampaignEmail = Effect.fn("renderCampaignEmail")(
  function* (input: {
    readonly templateKey: CampaignTemplateKey;
    readonly locale: Locale;
    readonly content: CampaignLocaleContent;
    readonly footer: CampaignEmailFooter;
  }) {
    const { Email } = campaignTemplates[input.templateKey];
    const rendered = yield* renderWorkspaceEmail(
      <Email
        body={<CampaignBodyContent body={input.content.body} />}
        footer={footerProps(input.footer, input.locale)}
        locale={input.locale}
        preview={input.content.preheader}
      />
    );

    return { ...rendered, subject: input.content.subject };
  }
);
