"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  quoteReservationWithdrawal,
  type ReservationWithdrawalQuoteResult,
  type ReservationWithdrawalResult,
  withdrawFromReservation,
} from "@/features/account/withdrawal-actions";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  WithdrawalConfirmDialog,
  type WithdrawalDialogView,
} from "./withdrawal-confirm-dialog";

/**
 * The prominent "Withdraw from the contract" link (§1830a(2)) of a
 * reservation the customer can withdraw from now. It opens the withdrawal
 * dialog over the current page: the live quote, the statement to confirm,
 * then the receipt. Closing the dialog after a withdrawal refreshes the page,
 * so it shows the reservation cancelled.
 */
export function ReservationWithdrawalLink({
  className,
  locale,
  orderId,
  reference,
}: {
  /** Placement classes of this surface. */
  readonly className?: string;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
  /** The reservation number as the surface shows it. */
  readonly reference: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const quote = useWorkspaceAction(quoteReservationWithdrawal, {});
  const withdrawal = useWorkspaceAction(withdrawFromReservation, {});

  const loadQuote = () => quote.execute({ orderId });

  const openDialog = () => {
    withdrawal.reset();
    setOpen(true);
    loadQuote();
  };

  const changeOpen = (next: boolean) => {
    if (next || withdrawal.isExecuting) return;
    setOpen(false);
    if (withdrawal.result.data?.status === "withdrawn") router.refresh();
  };

  const confirm = (customerName: string | undefined) =>
    withdrawal.execute({
      orderId,
      ...(customerName !== undefined && { customerName }),
    });

  const view = dialogView({
    quoted: quote.result.data,
    quoteServerError: quote.result.serverError,
    quoteSettled: !quote.isIdle && !quote.isExecuting,
    submitted: withdrawal.result.data,
    submitError: withdrawal.hasErrored
      ? (withdrawal.result.serverError ??
        m.withdrawalSubmitFailed({}, { locale }))
      : undefined,
    submitting: withdrawal.isExecuting,
  });

  return (
    <>
      <button
        className={cn(
          "shrink-0 cursor-pointer self-center py-1 text-right text-[0.6875rem] leading-4 text-rose-700 underline-offset-4 hover:text-rose-800 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2",
          className
        )}
        data-reservation-withdrawal-link=""
        onClick={openDialog}
        type="button"
      >
        {m.reservationWithdrawalAction({}, { locale })}
      </button>
      <WithdrawalConfirmDialog
        locale={locale}
        onConfirm={confirm}
        onOpenChange={changeOpen}
        onRetry={loadQuote}
        open={open}
        reference={reference}
        view={view}
      />
    </>
  );
}

/** What the dialog shows for the quote and the submission so far. */
function dialogView({
  quoted,
  quoteServerError,
  quoteSettled,
  submitError,
  submitted,
  submitting,
}: {
  readonly quoted: ReservationWithdrawalQuoteResult | undefined;
  readonly quoteServerError: string | undefined;
  readonly quoteSettled: boolean;
  readonly submitError: string | undefined;
  readonly submitted: ReservationWithdrawalResult | undefined;
  readonly submitting: boolean;
}): WithdrawalDialogView {
  if (submitted?.status === "refused") {
    return { step: "refused", reason: submitted.reason };
  }
  if (!quoteSettled) return { step: "loading" };
  if (quoted?.status === "refused") {
    return { step: "refused", reason: quoted.reason };
  }
  if (quoted?.status !== "available") {
    return { step: "failed", message: quoteServerError };
  }
  if (submitted?.status === "withdrawn") {
    return {
      step: "received",
      quote: quoted.quote,
      receipt: submitted.receipt,
    };
  }
  return {
    step: "statement",
    quote: quoted.quote,
    pending: submitting,
    submitError,
    nameRequired: submitted?.status === "name_required",
  };
}
