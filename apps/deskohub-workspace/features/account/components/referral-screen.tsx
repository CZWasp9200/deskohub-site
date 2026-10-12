"use client";

import { Check, Copy, Gift } from "lucide-react";
import { useState } from "react";
import { type Locale, m } from "@/features/i18n";
import { referralCodeQueryParam } from "@/features/referrals/client";
import type { ReferralAccountSummary } from "@/features/referrals/contracts";
import { Button } from "@/shared/components/ui/button";

export function ReferralScreen({
  locale,
  summary,
}: {
  readonly locale: Locale;
  readonly summary?: ReferralAccountSummary;
}) {
  const link = summary
    ? `/${locale}/account?${new URLSearchParams({ [referralCodeQueryParam]: summary.code })}`
    : undefined;
  const discount = summary
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
        Number(summary.discount)
      )}%`
    : undefined;

  return (
    <section
      aria-labelledby="account-referrals-title"
      className="min-w-0"
      data-screen="referrals-screen"
    >
      <div className="rounded-3xl border border-[#dfe4ec] bg-white p-5 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff2df] text-[#a84e12]">
            <Gift aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2
              className="text-2xl font-semibold text-navy-blue sm:text-3xl"
              id="account-referrals-title"
            >
              {m.accountReferralsTitle({}, { locale })}
            </h2>
            <p className="mt-2 text-sm leading-6 text-navy-blue/68">
              {m.accountReferralsDescription({}, { locale })}
            </p>
          </div>
        </div>

        {summary && link && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
        )}
        {!summary && (
          <p
            className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
            role="status"
          >
            {m.accountReferralsSummaryUnavailable({}, { locale })}
          </p>
        )}

        {summary && discount && (
          <div className="mt-5 rounded-2xl bg-[#f4f6f8] p-4 text-sm leading-6 text-[#344258]">
            <p>
              {m.accountReferralsEligibleInvitees(
                { count: String(summary.eligibleInviteeCount) },
                { locale }
              )}
            </p>
            <p className="mt-1">
              {m.accountReferralsCurrentDiscount({ discount }, { locale })}
            </p>
            <p className="mt-3 text-[#52647c]">
              {m.accountReferralsRewardTerms({}, { locale })}
            </p>
          </div>
        )}
      </div>
    </section>
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
