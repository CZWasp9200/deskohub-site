"use client";

import type { AdministrationInvoiceIdType } from "@deskohub/workspace-admin-api";
import { FileX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdministrationAlert } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationPanelLoading } from "@/features/administration/loading";
import {
  ReservationCancellationConsequences,
  ReservationCancellationEffects,
  type ReservationCancellationFormValues,
  useReservationCancellationForm,
} from "@/features/administration/reservation-cancellation-consequences";
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
import {
  cancelAdministrationInvoice,
  previewAdministrationInvoiceCancellation,
} from "./actions";
import type { InvoiceCancellationPreview } from "./invoice-cancellation-preview";

type LiveInvoiceCancellationPreview = Extract<
  InvoiceCancellationPreview,
  { readonly state: "live" }
>;

/**
 * "Cancel invoice" with its confirmation. Opening it reads what cancelling
 * would do; the dialog warns about each consequence and submits exactly the
 * warnings it showed, so the server refuses when they have changed since.
 */
export function InvoiceCancellation({
  invoiceId,
  invoiceNumber,
  onCancelled,
  placement,
}: {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  /** Reports the outcome for the caller to show after the dialog closes. */
  readonly onCancelled: (message: string) => void;
  /** A list row's icon button, or the detail page's labelled button. */
  readonly placement: "row" | "detail";
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<InvoiceCancellationPreview | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const previewAction = useWorkspaceAction(
    previewAdministrationInvoiceCancellation,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setPreview(data);
        if (data.state === "cancelled") router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            m.accountingInvoiceCancelPreviewFailed({}, { locale })
        ),
      onTransportError: () =>
        setError(m.accountingInvoiceCancelPreviewFailed({}, { locale })),
    }
  );
  const cancelAction = useWorkspaceAction(cancelAdministrationInvoice, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      const { correctiveDocumentNumber } = data;
      onCancelled(
        data.reservationEmail
          ? {
              failed: m.accountingInvoiceCancelSucceededReservationEmailFailed,
              not_requested:
                m.accountingInvoiceCancelSucceededReservationEmailNotRequested,
              sent: m.accountingInvoiceCancelSucceededReservationEmailSent,
            }[data.reservationEmail]({ correctiveDocumentNumber }, { locale })
          : m.accountingInvoiceCancelSucceeded(
              { correctiveDocumentNumber },
              { locale }
            )
      );
      router.refresh();
    },
    onError: ({ error: actionError }) => {
      setError(
        actionError.serverError ??
          m.accountingInvoiceCancelFailed({}, { locale })
      );
      // A refusal such as a changed confirmation means the warnings are out
      // of date: read them again so the operator confirms the current ones.
      previewAction.execute({ invoiceId });
      router.refresh();
    },
    onTransportError: () =>
      setError(m.accountingInvoiceCancelInterrupted({}, { locale })),
  });

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setError(null);
        setOpen(nextOpen);
        if (nextOpen) {
          setPreview(null);
          previewAction.execute({ invoiceId });
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        {placement === "row" ? (
          <Button
            aria-label={m.accountingInvoiceCancelLabel(
              { invoiceNumber },
              { locale }
            )}
            size="icon"
            type="button"
            variant="ghost"
          >
            <FileX aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button type="button" variant="secondary">
            <FileX aria-hidden className="size-4" />{" "}
            {m.accountingInvoiceCancelOpen({}, { locale })}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.accountingInvoiceCancelTitle({ invoiceNumber }, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.accountingInvoiceCancelDescription(
              { invoiceNumber },
              { locale }
            )}
          </DialogDescription>
        </DialogHeader>
        {/* One region for the dialog's life: a re-read plan changes the
            form around it, never the region that announces a refusal. */}
        <div role="alert">
          {error && (
            <AdministrationAlert status="error">{error}</AdministrationAlert>
          )}
        </div>
        {preview?.state === "live" ? (
          <InvoiceCancellationForm
            isExecuting={cancelAction.isExecuting}
            locale={locale}
            onSubmit={(values) => {
              setError(null);
              cancelAction.execute({
                invoiceId,
                confirmedCustomerNotice: preview.customerNotice === "owed",
                ...(preview.reservation && {
                  reservation: {
                    sendCancellationEmail: values.sendCancellationEmail,
                  },
                }),
              });
            }}
            preview={preview}
          />
        ) : (
          <InvoiceCancellationPending
            loading={!preview && !error}
            locale={locale}
            preview={preview}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The dialog while it reads the plan, when reading failed, or when the invoice was cancelled meanwhile. */
function InvoiceCancellationPending({
  loading,
  locale,
  preview,
}: {
  readonly loading: boolean;
  readonly locale: Locale;
  readonly preview: InvoiceCancellationPreview | null;
}) {
  return (
    <>
      {loading && (
        <AdministrationPanelLoading
          label={m.accountingInvoiceCancelLoading({}, { locale })}
        />
      )}
      {preview?.state === "cancelled" && (
        <AdministrationAlert status="warning">
          {m.accountingInvoiceCancelAlreadyCancelled({}, { locale })}
        </AdministrationAlert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {m.accountingInvoiceCancelKeep({}, { locale })}
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/**
 * The confirmation for a live invoice: the notice the customer will get when
 * the invoice was sent, and the reservation cancelled with it, whose own
 * confirmations come from the reservation dialog's shared part.
 */
function InvoiceCancellationForm({
  isExecuting,
  locale,
  onSubmit,
  preview,
}: {
  readonly isExecuting: boolean;
  readonly locale: Locale;
  readonly onSubmit: (values: ReservationCancellationFormValues) => void;
  readonly preview: LiveInvoiceCancellationPreview;
}) {
  const form = useReservationCancellationForm();
  return (
    <Form {...form}>
      <form
        aria-label={m.accountingInvoiceCancelFormLabel({}, { locale })}
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
      >
        {preview.customerNotice === "owed" && (
          <AdministrationAlert status="warning">
            {m.accountingInvoiceCancelSentWarning(
              { invoiceNumber: preview.invoiceNumber },
              { locale }
            )}
          </AdministrationAlert>
        )}
        {preview.reservation && (
          <>
            <AdministrationAlert status="warning">
              <div className="space-y-1">
                <p>
                  {m.accountingInvoiceCancelReservationWarning(
                    { reservation: preview.reservation.label },
                    { locale }
                  )}
                </p>
                <p>
                  <ReservationCancellationEffects locale={locale} />
                </p>
              </div>
            </AdministrationAlert>
            <ReservationCancellationConsequences form={form} locale={locale} />
          </>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isExecuting} type="button" variant="secondary">
              {m.accountingInvoiceCancelKeep({}, { locale })}
            </Button>
          </DialogClose>
          <Button disabled={isExecuting} tone="burned-orange-ink" type="submit">
            {isExecuting
              ? m.accountingInvoiceCancelSubmitting({}, { locale })
              : m.accountingInvoiceCancelSubmit({}, { locale })}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
