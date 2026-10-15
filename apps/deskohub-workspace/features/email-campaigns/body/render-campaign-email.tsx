import { Data, Effect, Match } from "effect";
import { Text } from "react-email";
import { type Locale, m } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import type { CampaignConfirmationCode } from "../campaign-identifiers";
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
 * states that it is a service message, in the campaign's own words when the
 * locale content sets `operationalReason`.
 */
export type CampaignEmailFooter = Data.TaggedEnum<{
  Marketing: { readonly marketingPreferencesUrl: string };
  Operational: Record<never, never>;
}>;

export const CampaignEmailFooter = Data.taggedEnum<CampaignEmailFooter>();

const footerProps = ({
  footer,
  locale,
  content,
}: {
  readonly footer: CampaignEmailFooter;
  readonly locale: Locale;
  readonly content: CampaignLocaleContent;
}): CampaignTemplateProps["footer"] =>
  Match.valueTags(footer, {
    Marketing: ({ marketingPreferencesUrl }) => ({
      note: m.emailCampaignMarketingFooter({}, { locale }),
      link: {
        label: m.emailCampaignMarketingFooterLink({}, { locale }),
        href: marketingPreferencesUrl,
      },
    }),
    Operational: () => ({
      note:
        content.operationalReason ??
        m.emailCampaignOperationalFooter({}, { locale }),
    }),
  });

/**
 * Renders one locale of a campaign inside its template, as HTML and plain
 * text. A test email leads with the code that confirms the real send.
 */
export const renderCampaignEmail = Effect.fn("renderCampaignEmail")(
  function* (input: {
    readonly templateKey: CampaignTemplateKey;
    readonly locale: Locale;
    readonly content: CampaignLocaleContent;
    readonly footer: CampaignEmailFooter;
    readonly confirmationCode?: CampaignConfirmationCode;
  }) {
    const { Email } = campaignTemplates[input.templateKey];
    const rendered = yield* renderWorkspaceEmail(
      <Email
        body={
          <>
            {input.confirmationCode && (
              <Text className="m-0 mb-4 rounded-[8px] border border-[#ffd166] border-solid bg-[#fff8e1] px-4 py-3 text-[14px] leading-[20px] text-[#1c1f3b]">
                {m.emailCampaignTestNotice(
                  { code: input.confirmationCode },
                  { locale: input.locale }
                )}
              </Text>
            )}
            <CampaignBodyContent body={input.content.body} />
          </>
        }
        footer={footerProps(input)}
        locale={input.locale}
        preview={input.content.preheader}
      />
    );

    return { ...rendered, subject: input.content.subject };
  }
);
