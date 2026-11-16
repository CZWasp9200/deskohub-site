"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { type UseFormReturn, useForm } from "react-hook-form";
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
  sendCancellationEmail: Schema.Boolean,
});

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
  sendCancellationEmail: true,
} satisfies ReservationCancellationFormInput;

/** The operator's answer for cancelling a reservation: the cancellation email. */
export const useReservationCancellationForm = (): ReservationCancellationForm =>
  useForm<
    ReservationCancellationFormInput,
    unknown,
    ReservationCancellationFormValues
  >({
    defaultValues: reservationCancellationFormDefaults,
    mode: "onSubmit",
    resolver: effectSchemaResolver(reservationCancellationFormSchema),
  });

/** What cancelling a reservation does in Dotypos and to its payments. */
export function ReservationCancellationEffects({
  locale,
}: {
  readonly locale: Locale;
}) {
  return m.administrationReservationCancellationDescription({}, { locale });
}

/**
 * The reservation cancellation's confirmation: whether the customer gets the
 * cancellation email. The reservation dialog and the invoice dialog both
 * render it.
 */
export function ReservationCancellationConsequences({
  form,
  locale,
}: {
  readonly form: ReservationCancellationForm;
  readonly locale: Locale;
}) {
  return (
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
  );
}
