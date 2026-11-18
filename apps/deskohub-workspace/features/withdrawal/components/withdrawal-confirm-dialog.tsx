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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [name, setName] = useState(quote.customerName ?? "");
  const [receiptEmail, setReceiptEmail] = useState(quote.receiptEmail);
  const [submitted, setSubmitted] = useState(initialErrors);

  const nameError = submitted && name.trim() === "";
  const emailError = submitted && !emailPattern.test(receiptEmail.trim());
  const basis = quote.refundBasis;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() === "" || !emailPattern.test(receiptEmail.trim())) return;
    onConfirm({ name: name.trim(), receiptEmail: receiptEmail.trim() });
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
          <dl className="m-0 grid gap-3">
            <ContractRow label={m.withdrawalConfirmReferenceLabel({}, { locale })}>
              <span className="font-mono text-sm">{reference}</span>
            </ContractRow>
            <ContractRow label={m.withdrawalConfirmContractLabel({}, { locale })}>
              {quote.contractLabel}
            </ContractRow>
            <ContractRow label={m.withdrawalConfirmPaidLabel({}, { locale })}>
              {formatMoney(quote.paidAmount, locale)}
            </ContractRow>
          </dl>

          <div className="grid gap-4">
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
            <div className="grid gap-2">
              <Label htmlFor="withdrawal-email">
                {m.withdrawalConfirmEmailLabel({}, { locale })}
              </Label>
              <Input
                aria-describedby={
                  emailError ? "withdrawal-email-error" : undefined
                }
                aria-invalid={emailError || undefined}
                autoComplete="email"
                className="aria-invalid:border-red-700"
                disabled={pending}
                id="withdrawal-email"
                inputMode="email"
                onChange={(event) => setReceiptEmail(event.target.value)}
                type="email"
                value={receiptEmail}
              />
              {emailError && (
                <p
                  className="text-sm font-medium text-red-700"
                  id="withdrawal-email-error"
                >
                  {m.withdrawalConfirmEmailInvalid({}, { locale })}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-[#f6f8fa] p-4 text-sm leading-6 text-[#475569]">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span>{m.withdrawalConfirmRefundLabel({}, { locale })}</span>
              <span className="text-2xl font-semibold text-navy-blue">
                {formatMoney(quote.refundAmount, locale)}
              </span>
            </div>
            {basis.kind === "partial" && (
              <p className="mt-2">
                {(basis.unit === "hour"
                  ? m.withdrawalConfirmRefundPartialHours
                  : m.withdrawalConfirmRefundPartialDays)(
                  { unstarted: basis.unstarted, total: basis.total },
                  { locale }
                )}
              </p>
            )}
            <p className="mt-2">{m.withdrawalConfirmRefundWhen({}, { locale })}</p>
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
