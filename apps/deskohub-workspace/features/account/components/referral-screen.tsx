"use client";

import { Check, Copy, Info } from "lucide-react";
import { useState } from "react";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import {
  formatReferralDiscount,
  referralCodeQueryParam,
} from "@/features/referrals/client";
import type { ReferralAccountSummary } from "@/features/referrals/contracts";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

export function ReferralScreen({
  locale,
  summary,
}: {
  readonly locale: Locale;
  readonly summary?: ReferralAccountSummary;
}) {
  if (!summary) {
    return (
      <div className="min-w-0" data-screen="referrals-screen">
        <AccountSectionPanel
          title={m.accountReferralsCountTitle({}, { locale })}
        >
          <p
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
            role="status"
          >
            {m.accountReferralsSummaryUnavailable({}, { locale })}
          </p>
        </AccountSectionPanel>
      </div>
    );
  }

  const link = `/${locale}/account?${new URLSearchParams({ [referralCodeQueryParam]: summary.code })}`;
  const total = String(summary.inviteeCount);
  const eligible = String(summary.eligibleInviteeCount);

  return (
    <div className="min-w-0 space-y-8" data-screen="referrals-screen">
      <div className="grid min-w-0 gap-8 @xl:grid-cols-2">
        <AccountSectionPanel
          actions={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={m.accountReferralsCountInfoLabel(
                      {},
                      { locale }
                    )}
                    className="size-8 rounded-full p-0 text-navy-blue/60"
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Info aria-hidden="true" className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  align="end"
                  className="w-[min(20rem,calc(100vw-2rem))] break-words whitespace-normal"
                  collisionPadding={16}
                >
                  {m.accountReferralsCountInfo({}, { locale })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          title={m.accountReferralsCountTitle({}, { locale })}
        >
          <p
            aria-hidden="true"
            className="flex flex-wrap items-baseline gap-x-3 leading-none"
          >
            <span
              className="text-5xl font-bold tabular-nums tracking-tight text-sunset-yellow-ink @sm:text-6xl"
              id="account-referrals-eligible-count"
            >
              {eligible}
            </span>
            <span className="text-2xl font-semibold tabular-nums text-[#64748b]">
              / {total}
            </span>
          </p>
          <p className="sr-only">
            {m.accountReferralsCountSummary({ eligible, total }, { locale })}
          </p>
          {summary.inviteeCount === 0 && (
            <p className="mt-4 text-sm leading-6 text-[#51627c]">
              {m.accountReferralsCountEmpty({}, { locale })}
            </p>
          )}
        </AccountSectionPanel>

        <AccountSectionPanel
          title={m.accountReferralsDiscountTitle({}, { locale })}
        >
          <p
            className="text-5xl font-bold tabular-nums tracking-tight leading-none text-aquamarine-ink @sm:text-6xl"
            id="account-referrals-discount"
          >
            {formatReferralDiscount(summary.discount, locale)}
          </p>
          {summary.savings.length > 0 ? (
            <p className="mt-4 text-sm leading-6 text-[#51627c]">
              {m.accountReferralsSavedLabel({}, { locale })}
              <span className="mt-0.5 block text-xl font-semibold leading-7 text-navy-blue">
                {new Intl.ListFormat(locale).format(
                  summary.savings.map((amount) =>
                    formatWorkspaceMoney(amount, locale)
                  )
                )}
              </span>
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[#51627c]">
              {m.accountReferralsSavedNothing({}, { locale })}
            </p>
          )}
        </AccountSectionPanel>
      </div>

      <AccountSectionPanel
        title={m.accountReferralsTitle({}, { locale })}
        titleId="account-referrals-title"
      >
        <div className="grid min-w-0 gap-4 @xl:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-[#fbfaf7] p-4">
            <p className="text-sm font-semibold text-[#344258]">
              {m.accountReferralsCodeLabel({}, { locale })}
            </p>
            <code
              className="mt-2 block break-all text-lg font-semibold tracking-wide text-navy-blue"
              id="account-referrals-code"
            >
              {summary.code}
            </code>
          </div>
          <div className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-[#fbfaf7] p-4">
            <p className="text-sm font-semibold text-[#344258]">
              {m.accountReferralsLinkLabel({}, { locale })}
            </p>
            <a
              className="mt-2 block break-all text-sm text-burned-orange underline underline-offset-4"
              href={link}
              id="account-referrals-link"
            >
              {link}
            </a>
            <CopyReferralLinkButton link={link} locale={locale} />
          </div>
        </div>
      </AccountSectionPanel>

      <AccountSectionPanel title={m.accountReferralsHowTitle({}, { locale })}>
        <ul className="m-0 min-w-0 list-disc space-y-3 pl-5 text-sm leading-6 text-[#344258] marker:text-[#8291a6]">
          <li>{m.accountReferralsHowInvite({}, { locale })}</li>
          <li>{m.accountReferralsHowEligible({}, { locale })}</li>
          <li>{m.accountReferralsHowDiscount({}, { locale })}</li>
          <li>{m.accountReferralsHowSavings({}, { locale })}</li>
        </ul>
      </AccountSectionPanel>
    </div>
  );
}

function CopyReferralLinkButton({
  link,
  locale,
}: {
  readonly link: string;
  readonly locale: Locale;
}) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed">();

  const copyLink = async () => {
    setCopyStatus(undefined);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(
        new URL(link, window.location.origin).href
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <div className="mt-3">
      <Button
        className="h-auto min-h-10 whitespace-normal rounded-full px-4 py-2 text-sm"
        onClick={copyLink}
        type="button"
        variant="secondary"
      >
        {copyStatus === "copied" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {copyStatus === "copied"
          ? m.accountReferralsCopied({}, { locale })
          : m.accountReferralsCopyLink({}, { locale })}
      </Button>
      {copyStatus === "failed" && (
        <p
          className="mt-2 text-sm leading-5 text-burned-orange-ink"
          role="status"
        >
          {m.accountReferralsCopyUnavailable({}, { locale })}
        </p>
      )}
    </div>
  );
}
