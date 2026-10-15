"use client";

import { Option, Predicate } from "effect";
import { CalendarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isLocale, m } from "@/features/i18n";
import { fieldTriggerVariants } from "@/shared/components/ui/field-trigger";
import { useFormField } from "@/shared/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import {
  createPreloadableModule,
  useLoadedModule,
  usePreloadWhenIdle,
} from "@/shared/utils/preloadable-module";
import { parsePlainDate } from "@/shared/utils/temporal";

export type ReservationDatePickerProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaLabel: string;
  readonly ariaRequired?: boolean;
  readonly className?: string;
  readonly displayValue?: string;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly id?: string;
  readonly maximum?: string | (() => string);
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly value?: string;
  readonly variant?: "default" | "error";
};

// The day picker stays out of the page bundle. It preloads when the browser
// is idle or the trigger is approached, and the popover opens only once it is
// loaded, so the popover never shows a loading state. An open requested
// before then is dropped if the user moves on.
const reservationCalendar = createPreloadableModule(
  () => import("@/shared/components/ui/calendar")
);

const parseCalendarDate = (value: string | undefined) =>
  value ? Option.getOrUndefined(parsePlainDate(value)) : undefined;

const getCalendarDate = (date: Temporal.PlainDate) =>
  new Date(date.year, date.month - 1, date.day, 12);

const getPlainDateFromCalendar = (date: Date) =>
  Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

export function ReservationDatePicker({
  ariaDescribedBy,
  ariaInvalid,
  ariaLabel,
  ariaRequired,
  className,
  displayValue,
  isDateDisabled,
  locale,
  id,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  placeholder = "Pick a date",
  value,
  variant = "default",
}: ReservationDatePickerProps) {
  const [openRequested, setOpenRequested] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendar = useLoadedModule(reservationCalendar);
  usePreloadWhenIdle(reservationCalendar);
  const open = openRequested && calendar !== undefined;
  const openPending = openRequested && calendar === undefined;

  useEffect(() => {
    if (!openPending) return;

    // Leaving the trigger dismisses the pending open as it would dismiss the
    // open popover, including the blur that runs onBlur validation.
    const dismiss = () => {
      setOpenRequested(false);
      onBlur?.();
    };
    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        triggerRef.current?.contains(event.target)
      ) {
        return;
      }
      dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [onBlur, openPending]);
  const accessibleLabel = ariaRequired
    ? `${ariaLabel}, ${m.requiredFieldLabel(
        {},
        isLocale(locale) ? { locale } : undefined
      )}`
    : ariaLabel;
  const selectedDate = parseCalendarDate(value);
  const maximumDate = parseCalendarDate(
    Predicate.isFunction(maximum) ? maximum() : maximum
  );
  const minimumDate = parseCalendarDate(
    Predicate.isFunction(minimum) ? minimum() : minimum
  );

  return (
    <>
      {name && <input name={name} type="hidden" value={value ?? ""} />}
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          // The popover opens once the calendar is loaded. A failed chunk load
          // leaves it closed; the next open request retries it.
          if (nextOpen) reservationCalendar.preload();
          setOpenRequested(nextOpen);
          // The calendar replaces a native input, so closing it is the
          // field's blur; this lets onBlur form validation run.
          if (!nextOpen) onBlur?.();
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            id={id}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={accessibleLabel}
            onFocus={reservationCalendar.preload}
            onPointerDown={reservationCalendar.preload}
            onPointerEnter={reservationCalendar.preload}
            className={cn(fieldTriggerVariants({ variant }), className)}
            data-placeholder={selectedDate ? undefined : ""}
            type="button"
          >
            <CalendarIcon className="h-5 w-5 text-burned-orange" />
            {selectedDate
              ? (displayValue ??
                formatPlainDate({
                  date: selectedDate,
                  dateStyle: "long",
                  locale,
                }))
              : placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={ariaLabel}
          className="w-auto p-3"
        >
          {calendar && (
            <calendar.Calendar
              disabled={(date) => {
                const plainDate = getPlainDateFromCalendar(date);
                return Boolean(
                  (minimumDate &&
                    Temporal.PlainDate.compare(plainDate, minimumDate) < 0) ||
                    (maximumDate &&
                      Temporal.PlainDate.compare(plainDate, maximumDate) > 0) ||
                    isDateDisabled?.(plainDate)
                );
              }}
              mode="single"
              onSelect={(date) => {
                if (!date) return;

                const plainDate = getPlainDateFromCalendar(date);
                if (
                  (minimumDate &&
                    Temporal.PlainDate.compare(plainDate, minimumDate) < 0) ||
                  (maximumDate &&
                    Temporal.PlainDate.compare(plainDate, maximumDate) > 0) ||
                  isDateDisabled?.(plainDate)
                ) {
                  return;
                }

                onChange?.(plainDate.toString());
                setOpenRequested(false);
                onBlur?.();
              }}
              selected={
                selectedDate ? getCalendarDate(selectedDate) : undefined
              }
            />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

export function ReservationFormDatePicker(props: ReservationDatePickerProps) {
  const { error, formItemId, formMessageId } = useFormField();

  return (
    <ReservationDatePicker
      {...props}
      id={formItemId}
      ariaDescribedBy={error ? formMessageId : undefined}
      ariaInvalid={Boolean(error)}
      ariaRequired
    />
  );
}
