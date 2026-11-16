"use client";

import type { AdministrationWorkspaceReservationIdType } from "@deskohub/workspace-admin-api";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReservationInvoiceStanding } from "@/features/accounting/backend/reservation-invoice-standing";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Form } from "@/shared/components/ui/form";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { cancelAdministrationReservation } from "./actions";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";
import {
  ReservationCancellationConsequences,
  ReservationCancellationEffects,
  type ReservationCancellationForm,
  type ReservationCancellationFormValues,
  useReservationCancellationForm,
} from "./reservation-cancellation-consequences";

/** The reservation's invoice as its cancellation dialog warns about it. */
type ReservationCancellationInvoice = Pick<
  ReservationInvoiceStanding,
  "invoiceNumber" | "state" | "customerNotice"
>;

export function ReservationCancellation({
  canCancel,
  invoice,
  reservationId,
}: {
  readonly canCancel: boolean;
  /** The reservation's latest invoice; `null` without one. */
  readonly invoice: ReservationCancellationInvoice | null;
  readonly reservationId: AdministrationWorkspaceReservationIdType;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useReservationCancellationForm();
  const liveInvoice = invoice?.state === "live" ? invoice : null;
  const { execute, isExecuting } = useWorkspaceAction(
    cancelAdministrationReservation,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setOpen(false);
        setMessage(
          {
            failed: m.administrationReservationCancellationEmailFailed,
            not_requested:
              m.administrationReservationCancellationEmailNotRequested,
            sent: m.administrationReservationCancellationEmailSent,
          }[data.email]({}, { locale })
        );
        router.refresh();
      },
      onError: ({ error: actionError }) => {
        setError(
          actionError.serverError ??
            m.administrationReservationCancellationFailed({}, { locale })
        );
        // A refusal may come from an invoice the dialog didn't warn about:
        // the refreshed page shows the current warning before a retry.
        router.refresh();
      },
      onTransportError: () =>
        setError(
          m.administrationReservationCancellationInterrupted({}, { locale })
        ),
    }
  );

  if (!canCancel && !message) return null;

  return (
    <div className="space-y-2">
      {canCancel && (
        <ReservationCancellationDialog
          error={error}
          form={form}
          invoice={liveInvoice}
          isExecuting={isExecuting}
          locale={locale}
          onOpenChange={(nextOpen) => {
            setError(null);
            setOpen(nextOpen);
          }}
          onSubmit={(values) => {
            setError(null);
            execute({
              // What the dialog warned about, so the server refuses a
              // cancellation whose invoice consequences changed since.
              confirmedConsequences: {
                invoice: liveInvoice !== null,
                customerNotice: liveInvoice?.customerNotice === "owed",
              },
              reservationId,
              sendCancellationEmail: values.sendCancellationEmail,
            });
          }}
          open={open}
        />
      )}
      {message && (
        <AdministrationAlert role="status" status="success">
          {message}
        </AdministrationAlert>
      )}
    </div>
  );
}

/**
 * Asks the operator to confirm the cancellation, and warns that the live
 * invoice is cancelled with it.
 */
function ReservationCancellationDialog({
  error,
  form,
  invoice,
  isExecuting,
  locale,
  onOpenChange,
  onSubmit,
  open,
}: {
  readonly error: string | null;
  readonly form: ReservationCancellationForm;
  readonly invoice: ReservationCancellationInvoice | null;
  readonly isExecuting: boolean;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: ReservationCancellationFormValues) => void;
  readonly open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          {m.administrationReservationCancellationOpen({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.administrationReservationCancellationTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            <ReservationCancellationEffects locale={locale} />
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            aria-label={m.administrationReservationCancellationFormLabel(
              {},
              { locale }
            )}
            noValidate
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
          >
            {invoice && (
              <AdministrationAlert status="warning">
                <div className="space-y-1">
                  <p>
                    {m.administrationReservationCancellationInvoiceWarning(
                      { invoiceNumber: invoice.invoiceNumber },
                      { locale }
                    )}
                  </p>
                  {invoice.customerNotice === "owed" && (
                    <p>
                      {m.administrationReservationCancellationInvoiceNoticeWarning(
                        {},
                        { locale }
                      )}
                    </p>
                  )}
                </div>
              </AdministrationAlert>
            )}
            <ReservationCancellationConsequences form={form} locale={locale} />
            <div role="alert">
              {error && (
                <AdministrationAlert status="error">
                  {error}
                </AdministrationAlert>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={isExecuting}
                  type="button"
                  variant="secondary"
                >
                  {m.administrationReservationCancellationKeep({}, { locale })}
                </Button>
              </DialogClose>
              <Button
                disabled={isExecuting}
                tone="burned-orange-ink"
                type="submit"
              >
                {isExecuting
                  ? m.administrationReservationCancellationSubmitting(
                      {},
                      { locale }
                    )
                  : m.administrationReservationCancellationSubmit(
                      {},
                      { locale }
                    )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
