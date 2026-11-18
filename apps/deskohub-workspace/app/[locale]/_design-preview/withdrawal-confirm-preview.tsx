// DESIGN PREVIEW ONLY (online withdrawal visual rounds, screen 03): the
// confirm step open over a preview page with a synthetic quote.
"use client";

import { useState } from "react";
import type { Locale } from "@/features/i18n";
import { WithdrawalConfirmDialog } from "@/features/withdrawal/components/withdrawal-confirm-dialog";
import type { WithdrawalQuoteData } from "@/features/withdrawal/withdrawal-read-model";

export function WithdrawalConfirmPreview({
  locale,
  quote,
  reference,
  state,
}: {
  readonly locale: Locale;
  readonly quote: WithdrawalQuoteData;
  readonly reference: string;
  readonly state: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <WithdrawalConfirmDialog
      initialErrors={state === "empty"}
      locale={locale}
      onConfirm={() => undefined}
      onOpenChange={setOpen}
      open={open}
      pending={state === "pending"}
      quote={quote}
      reference={reference}
    />
  );
}
