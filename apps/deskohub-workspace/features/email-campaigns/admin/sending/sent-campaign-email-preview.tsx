"use client";

import { useState } from "react";
import type { Locale } from "@/features/i18n";
import { CampaignInboxPreview } from "../email-preview/campaign-inbox-preview";

/** The sent campaign's email per locale, switched with the language toggle. */
export function SentCampaignEmailPreview({
  emails,
}: {
  readonly emails: readonly {
    readonly locale: Locale;
    readonly subject: string;
    readonly preheader: string;
    readonly html: string | undefined;
  }[];
}) {
  const [locale, setLocale] = useState(emails[0]?.locale);
  const email = emails.find((candidate) => candidate.locale === locale);
  if (!email) return null;
  return (
    <CampaignInboxPreview
      error={email.html ? undefined : "The email could not be rendered."}
      html={email.html}
      locale={email.locale}
      locales={emails.map((candidate) => candidate.locale)}
      onLocaleChange={setLocale}
      placeholder="No preview available."
      preheader={email.preheader}
      subject={email.subject}
    />
  );
}
