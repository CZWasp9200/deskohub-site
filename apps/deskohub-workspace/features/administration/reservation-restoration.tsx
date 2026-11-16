"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type {
  AdministrationReservationRestorationResultType,
  AdministrationWorkspaceReservationIdType,
} from "@deskohub/workspace-admin-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { useRouter } from "next/navigation";
import type { SingleInputActionFn } from "next-safe-action/hooks";
import { useState } from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { formatMoney } from "@/shared/money/money";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type { AdministrationReservationDetail } from "./administration.service";
import type { ReservationRestorationInput } from "./contracts";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";

/** What restoring the reservation would do, from the reservation detail. */
export type ReservationRestorationPreview = NonNullable<
  AdministrationReservationDetail["restoration"]
>;

/** What the operator asks for when restoring a reservation. */
export type ReservationRestorationRequest = ReservationRestorationInput;

/** How a restoration ended, as the restore action reports it. */
export type ReservationRestorationResult =
  AdministrationReservationRestorationResultType;

/** The operator action that restores a cancelled reservation. */
export type ReservationRestorationAction = SingleInputActionFn<
  string,
  StandardSchemaV1<ReservationRestorationRequest>,
  unknown,
  ReservationRestorationResult
>;

const reservationRestorationFormSchema = Schema.Struct({
  acknowledgeRefundedPayment: Schema.Boolean,
  sendRestorationEmail: Schema.Boolean,
});

const getAcknowledgedReservationRestorationFormSchema = (locale: Locale) =>
  reservationRestorationFormSchema.check(
    Schema.makeFilter<{
      readonly acknowledgeRefundedPayment: boolean;
      readonly sendRestorationEmail: boolean;
    }>(
      (values) =>
        values.acknowledgeRefundedPayment || {
          path: ["acknowledgeRefundedPayment"],
          issue:
            m.administrationReservationRestorationRefundAcknowledgementRequired(
              {},
              { locale }
            ),
        }
    )
  );

type ReservationRestorationFormInput =
  typeof reservationRestorationFormSchema.Encoded;

type ReservationRestorationFormValues =
  typeof reservationRestorationFormSchema.Type;

const reservationRestorationFormDefaults = {
  acknowledgeRefundedPayment: false,
  sendRestorationEmail: true,
} satisfies ReservationRestorationFormInput;

type ReservationRestorationNotice = {
  readonly status: "success" | "warning";
  readonly message: string;
};

const getReservationRestorationNotices = (
  result: ReservationRestorationResult,
  locale: Locale
): readonly ReservationRestorationNotice[] => [
  {
    status: "success",
    message:
      result.outcome === "already_confirmed"
        ? m.administrationReservationRestorationAlreadyRestored({}, { locale })
        : {
            failed: m.administrationReservationRestorationEmailFailed,
            not_available:
              m.administrationReservationRestorationEmailNotAvailable,
            not_requested:
              m.administrationReservationRestorationEmailNotRequested,
            sent: m.administrationReservationRestorationEmailSent,
          }[result.email]({}, { locale }),
  },
  ...(
    {
      issued: [
        {
          status: "success",
          message: m.administrationReservationRestorationAccessIssued(
            {},
            { locale }
          ),
        },
      ],
      failed: [
        {
          status: "warning",
          message: m.administrationReservationRestorationAccessFailed(
            {},
            { locale }
          ),
        },
      ],
      not_needed: [],
    } satisfies Record<
      ReservationRestorationResult["access"],
      readonly ReservationRestorationNotice[]
    >
  )[result.access],
];

/**
 * Restores a cancelled reservation after the operator confirms what it does:
 * a refund already returned, a cleared refund requirement, a new access code,
 * and, when a cancellation email went out, whether to email the customer.
 */
export function ReservationRestoration({
  reservationId,
  restoration,
  restoreReservation,
}: {
  readonly reservationId: AdministrationWorkspaceReservationIdType;
  /** Null when the reservation can't be restored. */
  readonly restoration: ReservationRestorationPreview | null;
  readonly restoreReservation: ReservationRestorationAction;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<
    readonly ReservationRestorationNotice[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const requiresRefundAcknowledgement = restoration?.refundedPayment != null;
  const form = useForm<
    ReservationRestorationFormInput,
    unknown,
    ReservationRestorationFormValues
  >({
    defaultValues: reservationRestorationFormDefaults,
    mode: "onSubmit",
    resolver: effectSchemaResolver(
      requiresRefundAcknowledgement
        ? getAcknowledgedReservationRestorationFormSchema(locale)
        : reservationRestorationFormSchema
    ),
  });
  const { execute, isExecuting } = useWorkspaceAction(restoreReservation, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      form.reset(reservationRestorationFormDefaults);
      setNotices(getReservationRestorationNotices(data, locale));
      router.refresh();
    },
    // A refusal can come from facts the preview predates, such as a refund
    // the restore's own refund check just recorded, so reload the preview.
    onError: ({ error: actionError }) => {
      setError(
        actionError.serverError ??
          m.administrationReservationRestorationFailed({}, { locale })
      );
      router.refresh();
    },
    onTransportError: () =>
      setError(
        m.administrationReservationRestorationInterrupted({}, { locale })
      ),
  });

  if (!restoration && notices.length === 0 && error === null) return null;

  return (
    <div>
      {restoration && (
        <ReservationRestorationDialog
          error={error}
          form={form}
          isExecuting={isExecuting}
          locale={locale}
          onOpenChange={(nextOpen) => {
            setError(null);
            setOpen(nextOpen);
          }}
          onSubmit={(values) => {
            setError(null);
            execute({
              reservationId,
              acknowledgeRefundedPayment:
                requiresRefundAcknowledgement &&
                values.acknowledgeRefundedPayment,
              sendRestorationEmail:
                restoration.cancellationEmailRecorded &&
                values.sendRestorationEmail,
            });
          }}
          open={open}
          restoration={restoration}
        />
      )}
      {!restoration && error && (
        <div role="alert">
          <AdministrationAlert status="error">{error}</AdministrationAlert>
        </div>
      )}
      <div className="mt-2 space-y-2 empty:mt-0" role="status">
        {notices.map((notice) => (
          <AdministrationAlert key={notice.message} status={notice.status}>
            {notice.message}
          </AdministrationAlert>
        ))}
      </div>
    </div>
  );
}

/** Asks the operator to confirm the restoration and what it changes. */
function ReservationRestorationDialog({
  error,
  form,
  isExecuting,
  locale,
  onOpenChange,
  onSubmit,
  open,
  restoration,
}: {
  readonly error: string | null;
  readonly form: UseFormReturn<
    ReservationRestorationFormInput,
    unknown,
    ReservationRestorationFormValues
  >;
  readonly isExecuting: boolean;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: ReservationRestorationFormValues) => void;
  readonly open: boolean;
  readonly restoration: ReservationRestorationPreview;
}) {
  const [acknowledgeRefundedPayment] = useWatch({
    control: form.control,
    name: ["acknowledgeRefundedPayment", "sendRestorationEmail"],
  });
  const { refundedPayment } = restoration;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          {m.administrationReservationRestorationOpen({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.administrationReservationRestorationTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.administrationReservationRestorationDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            aria-label={m.administrationReservationRestorationFormLabel(
              {},
              { locale }
            )}
            noValidate
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
          >
            {refundedPayment && (
              <AdministrationAlert status="warning">
                {{
                  full: m.administrationReservationRestorationRefundedFull,
                  partial:
                    m.administrationReservationRestorationRefundedPartial,
                }[refundedPayment.coverage](
                  { amount: formatMoney(refundedPayment.amount, locale) },
                  { locale }
                )}
              </AdministrationAlert>
            )}
            {(restoration.clearsRefundRequirement ||
              restoration.issuesNewAccess) && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-navy-blue/70">
                {restoration.clearsRefundRequirement && (
                  <li>
                    {m.administrationReservationRestorationRefundRequirementCleared(
                      {},
                      { locale }
                    )}
                  </li>
                )}
                {restoration.issuesNewAccess && (
                  <li>
                    {m.administrationReservationRestorationNewAccess(
                      {},
                      { locale }
                    )}
                  </li>
                )}
              </ul>
            )}
            {refundedPayment && (
              <FormField
                control={form.control}
                name="acknowledgeRefundedPayment"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel asChild>
                      <ChoiceCard tone="warning">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              onChange(checked === true)
                            }
                          />
                        </FormControl>
                        <span className="leading-6">
                          {m.administrationReservationRestorationRefundAcknowledgement(
                            {},
                            { locale }
                          )}
                        </span>
                      </ChoiceCard>
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {restoration.cancellationEmailRecorded && (
              <FormField
                control={form.control}
                name="sendRestorationEmail"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel asChild>
                      <ChoiceCard>
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              onChange(checked === true)
                            }
                          />
                        </FormControl>
                        <span className="leading-6 text-navy-blue/70">
                          {m.administrationReservationRestorationSendEmail(
                            {},
                            { locale }
                          )}
                        </span>
                      </ChoiceCard>
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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
                  {m.administrationReservationRestorationKeep({}, { locale })}
                </Button>
              </DialogClose>
              <Button
                disabled={
                  isExecuting ||
                  (refundedPayment !== null && !acknowledgeRefundedPayment)
                }
                type="submit"
              >
                {isExecuting
                  ? m.administrationReservationRestorationSubmitting(
                      {},
                      { locale }
                    )
                  : m.administrationReservationRestorationSubmit(
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
