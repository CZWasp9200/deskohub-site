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
      initialErrors={false}
      locale={locale}
      onConfirm={() => undefined}
      onOpenChange={setOpen}
      open={open}
      pending={state === "pending"}
      quote={quote}
      receipt={
        state.startsWith("received")
          ? {
              withdrawalId: "withdrawal_01JY5A0B1C2D3E4F5G6H7J8K9M" as never,
              submittedAt: "2026-11-18T13:42:00Z",
              refundAmount: quote.refundAmount,
              receiptEmail: quote.receiptEmail,
            }
          : undefined
      }
      reference={reference}
    />
  );
}
