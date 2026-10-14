import type { CampaignRow } from "@/db/schema";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { campaignRecipientStatuses } from "../../campaign-states";
import { campaignLocales } from "../../recipient-locale";
import { describeAudienceFilter } from "../audience-filter-summary";
import { loadDiscountGroupOptions } from "../audiences/discount-group-options.server";
import {
  CampaignPurposeBadge,
  CampaignRecipientStatusBadge,
  CampaignStatusBadge,
} from "../campaign-list/campaign-badges";
import { campaignLocaleNames } from "./campaign-locale-names";
import { loadSentCampaign } from "./sent-campaign.server";
import { SentCampaignActions } from "./sent-campaign-actions";
import { SentRecipientTable } from "./sent-recipient-table";

/** The read-only view of a campaign that left Draft. */
export async function SentCampaignPage({
  campaign,
}: {
  readonly campaign: CampaignRow;
}) {
  const [{ send, audienceTitle }, discountGroups] = await Promise.all([
    loadSentCampaign(campaign.id),
    loadDiscountGroupOptions(),
  ]);
  const contentLocales = campaignLocales.filter(
    (locale) => campaign.content[locale] !== undefined
  );
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <SentCampaignActions
            campaignId={campaign.id}
            retryable={campaign.status === "failed"}
          />
        }
        eyebrow="Email campaign"
        title={campaign.title}
      />
      <div className="space-y-6">
        {
          {
            draft: null,
            sending: (
              <AdministrationAlert status="warning">
                Delivery is in progress. Recipient statuses update as the email
                provider reports them.
              </AdministrationAlert>
            ),
            sent: null,
            failed: (
              <AdministrationAlert status="error">
                Delivery failed for some recipients. Retry undelivered sends
                only to recipients who didn&apos;t get the email.
              </AdministrationAlert>
            ),
          }[campaign.status]
        }
        <AdministrationDetailSection title="Campaign">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdministrationFact
              label="Status"
              value={<CampaignStatusBadge status={campaign.status} />}
            />
            <AdministrationFact
              label="Purpose"
              value={<CampaignPurposeBadge purpose={campaign.purpose} />}
            />
            <AdministrationFact
              label="Sent"
              value={
                send
                  ? formatAdministrationDateTime(send.createdAt.toString())
                  : "Not recorded"
              }
            />
            <AdministrationFact
              label="Completed"
              value={
                send?.completedAt
                  ? formatAdministrationDateTime(send.completedAt.toString())
                  : "Not yet"
              }
            />
          </dl>
        </AdministrationDetailSection>
        <AdministrationDetailSection title="Audience at send time">
          {send ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <AdministrationFact
                label="Audience"
                value={audienceTitle ?? "Deleted audience"}
              />
              <AdministrationFact
                label="Filter"
                value={describeAudienceFilter(
                  send.audienceFilter,
                  discountGroups
                )}
              />
            </dl>
          ) : (
            <p className="text-sm text-navy-blue/65">
              No send was recorded for this campaign.
            </p>
          )}
        </AdministrationDetailSection>
        <AdministrationDetailSection title="Content">
          <dl className="grid gap-5 md:grid-cols-2">
            {contentLocales.map((locale) => (
              <div
                className="rounded-lg border border-navy-blue/10 p-4"
                key={locale}
              >
                <p className="mb-3 text-sm font-semibold">
                  {campaignLocaleNames[locale]}
                </p>
                <div className="space-y-3">
                  <AdministrationFact
                    label="Subject"
                    value={campaign.content[locale]?.subject}
                  />
                  <AdministrationFact
                    label="Preheader"
                    value={campaign.content[locale]?.preheader || "None"}
                  />
                </div>
              </div>
            ))}
          </dl>
        </AdministrationDetailSection>
        {send && (
          <>
            <AdministrationDetailSection title="Delivery">
              <p className="text-2xl font-semibold">
                {send.recipients.length}{" "}
                {send.recipients.length === 1 ? "recipient" : "recipients"}
              </p>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                {campaignRecipientStatuses.map((status) => (
                  <li className="flex items-center gap-2" key={status}>
                    <CampaignRecipientStatusBadge status={status} />
                    <span className="text-lg font-semibold tabular-nums">
                      {send.counts[status]}
                    </span>
                  </li>
                ))}
              </ul>
            </AdministrationDetailSection>
            <AdministrationDetailSection title="Recipients">
              <SentRecipientTable
                recipients={send.recipients.map((recipient) => ({
                  dotyposCustomerId: recipient.dotyposCustomerId,
                  locale: recipient.locale,
                  status: recipient.status,
                  statusUpdatedAt: recipient.statusUpdatedAt.toString(),
                }))}
              />
            </AdministrationDetailSection>
          </>
        )}
      </div>
    </AdministrationPage>
  );
}
