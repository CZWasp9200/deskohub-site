"use client";

import { CheckCircle2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import type {
  WithdrawalQuoteData,
  WithdrawalReceiptData,
  WithdrawalRefusal,
} from "@/features/withdrawal/withdrawal-read-model";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { formatMoney } from "@/shared/money/money";

/** What the withdrawal dialog shows, step by step. */
export type WithdrawalDialogView =
  /** The quote is being read. */
  | { readonly step: "loading" }
  /** The customer can't withdraw (any more), for `reason`. */
  | { readonly step: "refused"; readonly reason: WithdrawalRefusal }
  /** The quote couldn't be read; `message` is the server's, if any. */
  | { readonly step: "failed"; readonly message: string | undefined }
  /** The statement to confirm. */
  | {
      readonly step: "statement";
      readonly quote: WithdrawalQuoteData;
      readonly pending: boolean;
      /** The last submission failed: the server's message, or a fallback. */
      readonly submitError: string | undefined;
      /** The server asked for a typed name the profile couldn't supply. */
      readonly nameRequired: boolean;
    }
  /** The withdrawal was received. */
  | {
      readonly step: "received";
      readonly quote: WithdrawalQuoteData;
      readonly receipt: WithdrawalReceiptData;
    };

function ContractRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-1 rounded-2xl border border-navy-blue/8 bg-white/80 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/52">
        {label}
      </dt>
      <dd className="m-0 min-w-0 break-words text-base font-semibold text-navy-blue">
        {children}
      </dd>
    </div>
  );
}

/**
 * The withdrawal dialog (§1830a(3)–(5)): the statement with the contract,
 * the customer's name and receipt email, what they get back and a separate
 * "Confirm withdrawal" button, then its receipt. No reason, address or
 * signature.
 */
export function WithdrawalConfirmDialog({
  locale,
  onConfirm,
  onOpenChange,
  onRetry,
  open,
  reference,
  view,
}: {
  readonly locale: Locale;
  /** Submits the statement; `customerName` is the typed name, when asked. */
  readonly onConfirm: (customerName: string | undefined) => void;
  readonly onOpenChange: (open: boolean) => void;
  /** Reads the quote again after it failed. */
  readonly onRetry: () => void;
  readonly open: boolean;
  /** The reservation number as the surface shows it. */
  readonly reference: string;
  readonly view: WithdrawalDialogView;
}) {
  const pending = view.step === "statement" && view.pending;
  const close = () => onOpenChange(false);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent
        aria-describedby={
          view.step === "statement"
            ? undefined
            : "withdrawal-dialog-description"
        }
        className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
        locale={locale}
        // Open on the close button: focusing the name input would select a
        // typed name, one keystroke from erasing it.
        onOpenAutoFocus={(event) => {
          const closeButton =
            event.currentTarget instanceof HTMLElement
              ? event.currentTarget.querySelector<HTMLElement>(
                  ":scope > button"
                )
              : null;
          if (!closeButton) return;
          event.preventDefault();
          closeButton.focus();
        }}
      >
        <WithdrawalDialogBody
          locale={locale}
          onClose={close}
          onConfirm={onConfirm}
          onRetry={onRetry}
          reference={reference}
          view={view}
        />
      </DialogContent>
    </Dialog>
  );
}

function WithdrawalDialogBody({
  locale,
  onClose,
  onConfirm,
  onRetry,
  reference,
  view,
}: {
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onConfirm: (customerName: string | undefined) => void;
  readonly onRetry: () => void;
  readonly reference: string;
  readonly view: WithdrawalDialogView;
}) {
  switch (view.step) {
    case "loading":
      return <WithdrawalLoading locale={locale} />;
    case "refused":
      return (
        <WithdrawalNotice
          locale={locale}
          message={refusalMessages[view.reason]({}, { locale })}
          onClose={onClose}
          title={m.withdrawalUnavailableTitle({}, { locale })}
        />
      );
    case "failed":
      return (
        <WithdrawalNotice
          locale={locale}
          message={view.message ?? m.withdrawalLoadFailed({}, { locale })}
          onClose={onClose}
          onRetry={onRetry}
          title={m.withdrawalConfirmTitle({}, { locale })}
        />
      );
    case "statement":
      return (
        <WithdrawalStatementForm
          locale={locale}
          nameRequired={view.nameRequired}
          onConfirm={onConfirm}
          onDecline={onClose}
          pending={view.pending}
          quote={view.quote}
          reference={reference}
          submitError={view.submitError}
        />
      );
    case "received":
      return (
        <WithdrawalReceived
          locale={locale}
          onClose={onClose}
          quote={view.quote}
          receipt={view.receipt}
          reference={reference}
        />
      );
  }
}

const refusalMessages = {
  not_withdrawable: m.withdrawalRefusedNotWithdrawable,
  business_purpose: m.withdrawalRefusedBusinessPurpose,
  period_ended: m.withdrawalRefusedPeriodEnded,
  performance_started: m.withdrawalRefusedPerformanceStarted,
  already_withdrawn: m.withdrawalRefusedAlreadyWithdrawn,
  not_found: m.withdrawalRefusedNotFound,
} satisfies Record<WithdrawalRefusal, typeof m.withdrawalRefusedNotFound>;

/** The quote is on its way: the statement's shape, announced once. */
function WithdrawalLoading({ locale }: { readonly locale: Locale }) {
  return (
    <div className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{m.withdrawalConfirmTitle({}, { locale })}</DialogTitle>
        <DialogDescription
          className="sr-only"
          id="withdrawal-dialog-description"
        >
          {m.withdrawalLoading({}, { locale })}
        </DialogDescription>
      </DialogHeader>
      <div aria-hidden="true" className="grid gap-3">
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    </div>
  );
}

/** Why the statement can't be shown, with a retry where one can help. */
function WithdrawalNotice({
  locale,
  message,
  onClose,
  onRetry,
  title,
}: {
  readonly locale: Locale;
  readonly message: string;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  readonly title: string;
}) {
  return (
    <div className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription
          className="text-base leading-7 text-navy-blue/72"
          id="withdrawal-dialog-description"
        >
          {message}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        {onRetry && (
          <Button onClick={onRetry} size="lg" type="button">
            {m.withdrawalRetry({}, { locale })}
          </Button>
        )}
        <Button
          onClick={onClose}
          size="lg"
          type="button"
          variant={onRetry ? "secondary" : "primary"}
        >
          {m.withdrawalDialogClose({}, { locale })}
        </Button>
      </div>
    </div>
  );
}

function WithdrawalStatementForm({
  locale,
  nameRequired,
  onConfirm,
  onDecline,
  pending,
  quote,
  reference,
  submitError,
}: {
  readonly locale: Locale;
  readonly nameRequired: boolean;
  readonly onConfirm: (customerName: string | undefined) => void;
  readonly onDecline: () => void;
  readonly pending: boolean;
  readonly quote: WithdrawalQuoteData;
  readonly reference: string;
  readonly submitError: string | undefined;
}) {
  // The name comes from the account; an input stands in only when the
  // account has none to show (its contact details couldn't be read).
  const knownName = nameRequired ? null : quote.customerName;
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(nameRequired);

  const nameError = knownName === null && submitted && name.trim() === "";
  const basis = quote.refundBasis;
  const deduction = {
    ...quote.paidAmount,
    value: quote.paidAmount.value - quote.refundAmount.value,
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (knownName !== null) {
      onConfirm(undefined);
      return;
    }
    const typedName = name.trim();
    if (typedName !== "") onConfirm(typedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{m.withdrawalConfirmTitle({}, { locale })}</DialogTitle>
      </DialogHeader>

      <form className="mt-6 grid gap-6" noValidate onSubmit={submit}>
        <div className="grid gap-3">
          <dl className="m-0 grid gap-3">
            <ContractRow
              label={m.withdrawalConfirmReferenceLabel({}, { locale })}
            >
              <span className="font-mono text-sm">{reference}</span>
            </ContractRow>
            <ContractRow
              label={m.withdrawalConfirmContractLabel({}, { locale })}
            >
              {quote.contractLabel}
            </ContractRow>
            {knownName !== null && (
              <ContractRow
                label={m.withdrawalConfirmNameShownLabel({}, { locale })}
              >
                {knownName}
              </ContractRow>
            )}
          </dl>

          {knownName === null && (
            <div className="grid gap-2">
              <Label htmlFor="withdrawal-name">
                {m.withdrawalConfirmNameLabel({}, { locale })}
              </Label>
              <Input
                aria-describedby={
                  nameError ? "withdrawal-name-error" : undefined
                }
                aria-invalid={nameError || undefined}
                autoComplete="name"
                className="aria-invalid:border-red-700"
                disabled={pending}
                id="withdrawal-name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              {nameError && (
                <p
                  className="text-sm font-medium text-red-700"
                  id="withdrawal-name-error"
                >
                  {m.withdrawalConfirmNameRequired({}, { locale })}
                </p>
              )}
            </div>
          )}

          <dl className="m-0 grid gap-3">
            <ContractRow
              label={m.withdrawalConfirmReceiptLabel({}, { locale })}
            >
              {quote.receiptEmail}
            </ContractRow>
          </dl>
        </div>

        <div className="rounded-2xl border border-navy-blue/8 bg-white/80 px-4 py-3 text-navy-blue">
          <dl className="m-0 grid gap-2 text-sm tabular-nums">
            <div className="flex items-baseline justify-between gap-4">
              <dt>{m.withdrawalConfirmPaidLabel({}, { locale })}</dt>
              <dd className="m-0 shrink-0 text-right">
                {formatMoney(quote.paidAmount, locale)}
              </dd>
            </div>
            {basis.kind === "partial" && (
              <div className="flex items-baseline justify-between gap-4 text-navy-blue/60">
                <dt>
                  {{
                    hour: m.withdrawalConfirmStartedHours,
                    day: m.withdrawalConfirmStartedDays,
                  }[basis.unit](
                    {
                      started: basis.total - basis.unstarted,
                      total: basis.total,
                    },
                    { locale }
                  )}
                </dt>
                <dd className="m-0 shrink-0 text-right">
                  −{formatMoney(deduction, locale)}
                </dd>
              </div>
            )}
            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-navy-blue/10 pt-3 text-base font-semibold">
              <dt>{m.withdrawalConfirmRefundLabel({}, { locale })}</dt>
              <dd className="m-0 shrink-0 text-right">
                {formatMoney(quote.refundAmount, locale)}
              </dd>
            </div>
          </dl>
          <p className="mt-1 text-xs leading-5 text-navy-blue/60">
            {m.withdrawalConfirmRefundNote({}, { locale })}
          </p>
        </div>

        <p
          className="empty:hidden text-sm font-medium text-red-700"
          role="alert"
        >
          {!pending && submitError}
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            id="withdrawal-confirm-submit"
            pending={pending}
            size="lg"
            tone="danger"
            type="submit"
            wrap
          >
            {m.withdrawalConfirmSubmit({}, { locale })}
          </Button>
          <Button
            disabled={pending}
            onClick={onDecline}
            size="lg"
            tone="positive"
            type="button"
          >
            {m.withdrawalConfirmDecline({}, { locale })}
          </Button>
        </div>
      </form>
    </>
  );
}

/** The receipt of a submitted withdrawal (§1830a(5)): what, when, and the refund. */
function WithdrawalReceived({
  locale,
  onClose,
  quote,
  receipt,
  reference,
}: {
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly quote: WithdrawalQuoteData;
  readonly receipt: WithdrawalReceiptData;
  readonly reference: string;
}) {
  return (
    <div className="grid gap-6">
      <DialogHeader className="items-start gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-ink ring-8 ring-aquamarine-green/8">
          <CheckCircle2 aria-hidden="true" className="h-9 w-9" />
        </div>
        <DialogTitle>{m.withdrawalReceivedTitle({}, { locale })}</DialogTitle>
        <DialogDescription
          className="sr-only"
          id="withdrawal-dialog-description"
        >
          {m.withdrawalReceivedEmailed(
            { email: receipt.receiptEmail },
            { locale }
          )}
        </DialogDescription>
      </DialogHeader>
      <dl className="m-0 grid gap-3">
        <ContractRow label={m.withdrawalConfirmReferenceLabel({}, { locale })}>
          <span className="font-mono text-sm">{reference}</span>
        </ContractRow>
        <ContractRow label={m.withdrawalConfirmContractLabel({}, { locale })}>
          {quote.contractLabel}
        </ContractRow>
        <ContractRow label={m.withdrawalReceivedSubmittedLabel({}, { locale })}>
          {formatReservationDisplayDateTime(
            Temporal.Instant.from(receipt.submittedAt),
            locale
          )}
        </ContractRow>
        <ContractRow label={m.withdrawalConfirmRefundLabel({}, { locale })}>
          <span className="tabular-nums">
            {formatMoney(receipt.refundAmount, locale)}
          </span>
        </ContractRow>
      </dl>
      <p className="text-sm leading-6 text-navy-blue/70">
        {m.withdrawalReceivedEmailed(
          { email: receipt.receiptEmail },
          { locale }
        )}
      </p>
      <div className="flex justify-end">
        <Button
          className="sm:w-auto"
          fullWidth
          onClick={onClose}
          size="lg"
          type="button"
        >
          {m.withdrawalDialogClose({}, { locale })}
        </Button>
      </div>
    </div>
  );
}
