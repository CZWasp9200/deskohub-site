"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import type { WithdrawalQuoteData } from "@/features/withdrawal/withdrawal-read-model";
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
import { formatMoney } from "@/shared/money/money";

/** What the customer confirms: the name and the email for the receipt. */
export type WithdrawalStatement = {
  readonly name: string;
  readonly receiptEmail: string;
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
 * The withdrawal statement (§1830a(3)–(4)): the contract, prefilled name and
 * receipt email the customer can edit, what they get back, and a separate
 * "Confirm withdrawal" button. No reason, address or signature.
 */
export function WithdrawalConfirmDialog({
  initialErrors = false,
  locale,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  quote,
  reference,
}: {
  /** Design preview only: show the field errors as after a submit. */
  readonly initialErrors?: boolean;
  readonly locale: Locale;
  readonly onConfirm: (statement: WithdrawalStatement) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly pending?: boolean;
  readonly quote: WithdrawalQuoteData;
  /** The reservation number as the account shows it. */
  readonly reference: string;
}) {
  // The name comes from the account; an input stands in only when the
  // account has none to show (its contact details couldn't be read).
  const knownName = quote.customerName;
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(initialErrors);

  const nameError = knownName === null && submitted && name.trim() === "";
  const basis = quote.refundBasis;
  const deduction = {
    ...quote.paidAmount,
    value: quote.paidAmount.value - quote.refundAmount.value,
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const confirmedName = knownName ?? name.trim();
    if (confirmedName === "") return;
    onConfirm({ name: confirmedName, receiptEmail: quote.receiptEmail });
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent
        aria-describedby="withdrawal-confirm-description"
        className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
        locale={locale}
        // Open on the close button: focusing the prefilled name would select
        // it, one keystroke from erasing it.
        onOpenAutoFocus={(event) => {
          const close =
            event.currentTarget instanceof HTMLElement
              ? event.currentTarget.querySelector<HTMLElement>(
                  ":scope > button"
                )
              : null;
          if (!close) return;
          event.preventDefault();
          close.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{m.withdrawalConfirmTitle({}, { locale })}</DialogTitle>
          <DialogDescription id="withdrawal-confirm-description">
            {m.withdrawalConfirmLead({}, { locale })}
          </DialogDescription>
        </DialogHeader>

        <form className="mt-6 grid gap-6" noValidate onSubmit={submit}>
          <div className="grid gap-3">
          <dl className="m-0 grid gap-3">
            <ContractRow label={m.withdrawalConfirmReferenceLabel({}, { locale })}>
              <span className="font-mono text-sm">{reference}</span>
            </ContractRow>
            <ContractRow label={m.withdrawalConfirmContractLabel({}, { locale })}>
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
                aria-describedby={nameError ? "withdrawal-name-error" : undefined}
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
            <ContractRow label={m.withdrawalConfirmReceiptLabel({}, { locale })}>
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
                    {(basis.unit === "hour"
                      ? m.withdrawalConfirmStartedHours
                      : m.withdrawalConfirmStartedDays)(
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              size="lg"
              type="button"
              variant="secondary"
            >
              {m.withdrawalConfirmBack({}, { locale })}
            </Button>
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
