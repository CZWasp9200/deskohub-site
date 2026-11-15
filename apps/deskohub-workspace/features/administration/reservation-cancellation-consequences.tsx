"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { useEffect, useRef } from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { m } from "./i18n";

const reservationCancellationFormSchema = Schema.Struct({
  providerCredentialRemoved: Schema.Boolean,
  sendCancellationEmail: Schema.Boolean,
});

const getConfirmedReservationCancellationFormSchema = (locale: Locale) =>
  reservationCancellationFormSchema.check(
    Schema.makeFilter<{
      readonly providerCredentialRemoved: boolean;
      readonly sendCancellationEmail: boolean;
    }>(
      (values) =>
        values.providerCredentialRemoved || {
          path: ["providerCredentialRemoved"],
          issue: m.administrationReservationCancellationPinRemovedRequired(
            {},
            { locale }
          ),
        }
    )
  );

type ReservationCancellationFormInput =
  typeof reservationCancellationFormSchema.Encoded;

export type ReservationCancellationFormValues =
  typeof reservationCancellationFormSchema.Type;

export type ReservationCancellationForm = UseFormReturn<
  ReservationCancellationFormInput,
  unknown,
  ReservationCancellationFormValues
>;

const reservationCancellationFormDefaults = {
  providerCredentialRemoved: false,
  sendCancellationEmail: true,
} satisfies ReservationCancellationFormInput;

/**
 * The operator's answers for cancelling a reservation: the door PIN removal,
 * required when the reservation has an active PIN, and the cancellation email.
 * The PIN removal is confirmed for the access grant revision the dialog
 * showed, so a newer revision, as a refreshed page brings, asks again.
 */
export const useReservationCancellationForm = ({
  accessGrantUpdatedAt,
  locale,
  requiresProviderCredentialRemoval,
}: {
  readonly accessGrantUpdatedAt: string | null;
  readonly locale: Locale;
  readonly requiresProviderCredentialRemoval: boolean;
}): ReservationCancellationForm => {
  const form = useForm<
    ReservationCancellationFormInput,
    unknown,
    ReservationCancellationFormValues
  >({
    defaultValues: reservationCancellationFormDefaults,
    mode: "onSubmit",
    // Read on every render, so a re-read plan that starts or stops needing
    // the PIN removal validates against it without a new form.
    resolver: effectSchemaResolver(
      requiresProviderCredentialRemoval
        ? getConfirmedReservationCancellationFormSchema(locale)
        : reservationCancellationFormSchema
    ),
  });
  // The revision arrives with a refresh, which has no completion callback.
  const confirmedRevision = useRef(accessGrantUpdatedAt);
  useEffect(() => {
    if (confirmedRevision.current === accessGrantUpdatedAt) return;
    confirmedRevision.current = accessGrantUpdatedAt;
    form.resetField("providerCredentialRemoved");
  }, [accessGrantUpdatedAt, form]);
  return form;
};

/** Whether the form still waits for the operator to confirm the PIN removal. */
export const useAwaitsProviderCredentialRemoval = (
  form: ReservationCancellationForm,
  requiresProviderCredentialRemoval: boolean
) => {
  const providerCredentialRemoved = useWatch({
    control: form.control,
    name: "providerCredentialRemoved",
  });
  return requiresProviderCredentialRemoval && !providerCredentialRemoved;
};

/** What cancelling a reservation does in Dotypos and to its payments. */
export function ReservationCancellationEffects({
  locale,
}: {
  readonly locale: Locale;
}) {
  return m.administrationReservationCancellationDescription({}, { locale });
}

/**
 * The reservation cancellation's confirmations: the door PIN removal when it's
 * needed, and whether the customer gets the cancellation email. The
 * reservation dialog and the invoice dialog both render it.
 */
export function ReservationCancellationConsequences({
  form,
  locale,
  requiresProviderCredentialRemoval,
}: {
  readonly form: ReservationCancellationForm;
  readonly locale: Locale;
  readonly requiresProviderCredentialRemoval: boolean;
}) {
  return (
    <>
      {requiresProviderCredentialRemoval && (
        <FormField
          control={form.control}
          name="providerCredentialRemoved"
          render={({ field: { onChange, ...field } }) => (
            <FormItem>
              <FormLabel asChild>
                <ChoiceCard tone="warning">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => onChange(checked === true)}
                    />
                  </FormControl>
                  <span className="leading-6">
                    {m.administrationReservationCancellationPinRemoved(
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
      <FormField
        control={form.control}
        name="sendCancellationEmail"
        render={({ field: { onChange, ...field } }) => (
          <FormItem>
            <FormLabel asChild>
              <ChoiceCard>
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => onChange(checked === true)}
                  />
                </FormControl>
                <span className="leading-6 text-navy-blue/70">
                  {m.administrationReservationCancellationSendEmail(
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
    </>
  );
}
