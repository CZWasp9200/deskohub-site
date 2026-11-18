"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Option, Result, Schema } from "effect";
import { useId, useMemo } from "react";
import {
  type FieldName,
  type Resolver,
  useForm,
  useWatch,
} from "react-hook-form";
import type { PreloadedAdvertisedPrice } from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { getOfficeSeatsAmount } from "@/features/checkout/reservation-quote-office";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { defaultPhoneRegion, type Locale, m } from "@/features/i18n";
import {
  getOfficePeopleSeats,
  type OfficePeople,
  type OfficePeopleIssue,
  validateOfficePeople,
} from "@/features/office/office-people";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationFormDateInput } from "@/features/reservation/components/reservation-date-input";
import {
  ReservationCustomerFieldsFallback,
  ReservationFormFallback,
  ReservationSkeletonBlock,
  ReservationSkeletonField,
  ReservationSubmitFallback,
} from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import { useAdvertisedOptionPrices } from "@/features/reservation/components/use-advertised-option-prices";
import { useWatchedSelection } from "@/features/reservation/components/use-reservation-selection-url";
import {
  findOfficeSeatAdvertisedPriceRequest,
  getOfficeSeatAdvertisedPriceRequests,
  officeSeatOptions,
} from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDayCount,
  getOfficeReservationEndsOn,
  getOfficeReservationOrder,
  type OfficeReservationData,
  type OfficeReservationInput,
  officeReservationDetailsSchema,
  officeReservationSchema,
} from "@/features/reservation/office-reservation";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import type { PreloadedWorkspaceAvailability } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { formatMoney } from "@/shared/money/money";
import { OfficeDayCountInput } from "./office-day-count-input";
import { initialOfficePeople } from "./office-people-editing";
import { OfficePeopleField } from "./office-people-field";
import { getOfficeReservationSelectionSummary } from "./office-reservation-selection-summary";
import { useOfficeAvailability } from "./use-office-availability";
import { useOfficeDayCountBounds } from "./use-office-day-count-bounds";

type OfficeReservationFormProps = {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly seatCapacity: number;
  readonly initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly initialValues: OfficeReservationInput;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly today: string;
};

/**
 * The office form's values: the selection and contact, and who is coming.
 * The people list stays in form state between the steps and goes to the
 * server with the submitted reservation, never into the selection link.
 */
type OfficeReservationFormValues = OfficeReservationInput & {
  readonly people: OfficePeople;
};

/** A people list the server would refuse, as the booking form words it. */
const getOfficePeopleIssueError = (
  issue: OfficePeopleIssue,
  locale: Locale
) => {
  if (issue._tag === "NoPeople") {
    return {
      type: issue._tag,
      message: m.officePeopleNoPeople({}, { locale }),
    };
  }
  if (issue._tag === "OverCapacity") {
    return {
      type: issue._tag,
      message: m.officePeopleOverCapacity(
        { maximum: issue.seatCapacity },
        { locale }
      ),
    };
  }
  return {
    type: officeInviteeRejectedErrorType[issue.reason],
    message: {
      invalid: m.officePeopleInvalidEmail({}, { locale }),
      duplicate: m.officePeopleDuplicateEmail({}, { locale }),
      contact: m.officePeopleContactEmail({}, { locale }),
    }[issue.reason],
  };
};

const officeInviteeRejectedErrorType = {
  invalid: "invitee-invalid",
  duplicate: "invitee-duplicate",
  // The list marks the invitee row that repeats the contact's email.
  contact: "invitee-contact",
} as const;

/**
 * Adds the people check to the form's schema resolver: every invitee, then
 * that someone is coming and fits, against the contact email once known, so
 * an invitee who turns out to be the contact sends the booker back to the list.
 */
const withOfficePeopleCheck =
  (
    resolver: Resolver<OfficeReservationInput, unknown, OfficeReservationData>,
    { locale, seatCapacity }: { locale: Locale; seatCapacity: number }
  ): Resolver<OfficeReservationFormValues, unknown, OfficeReservationData> =>
  async (values, context, options) => {
    // The schema checks every field but the people list, which it does not know.
    const result = await resolver(values, context, {
      ...options,
      names: options.names?.filter(
        (name): name is FieldName<OfficeReservationInput> => name !== "people"
      ),
    });
    const checked = validateOfficePeople(values.people, {
      seatCapacity,
      contactEmail: values.email.trim() || undefined,
    });
    if (Result.isSuccess(checked)) return result;
    return {
      values: {},
      errors: {
        ...result.errors,
        people: getOfficePeopleIssueError(checked.failure, locale),
      },
    };
  };

const decodeSelection = Schema.decodeUnknownOption(
  officeReservationDetailsSchema
);

const getSelection = (
  startsOn: string | undefined,
  dayCount: number | undefined,
  seats: number | undefined
) => {
  if (!(startsOn && dayCount)) return undefined;

  return Option.getOrUndefined(
    decodeSelection({
      kind: "office",
      startsOn,
      endsOn: getOfficeReservationEndsOn({ startsOn, dayCount }),
      seats,
    })
  );
};

export function OfficeReservationForm({
  checkoutSessionId,
  checkoutCustomer,
  seatCapacity,
  initialAdvertisedPrices = [],
  initialAvailability,
  initialValues,
  locale,
  replacementToken,
  submittedCode,
  today,
}: OfficeReservationFormProps) {
  const initialPeople =
    (initialValues as Partial<OfficeReservationFormValues>).people ??
    initialOfficePeople;
  const form = useForm<
    OfficeReservationFormValues,
    unknown,
    OfficeReservationData
  >({
    resolver: withOfficePeopleCheck(
      effectSchemaResolver(officeReservationSchema(defaultPhoneRegion(locale))),
      { locale, seatCapacity }
    ),
    defaultValues: {
      ...initialValues,
      people: initialPeople,
      seats: getOfficePeopleSeats(initialPeople),
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const peopleLabelId = useId();
  const [contactName, contactEmail] = useWatch({
    control: form.control,
    name: ["name", "email"],
  });
  const watchedSelection = useWatchedSelection(
    officeSelectionLink,
    form.control
  );
  const { startsOn, dayCount, seats } = watchedSelection;
  const selection = useMemo(
    () => getSelection(startsOn, dayCount, seats),
    [dayCount, seats, startsOn]
  );
  const { availabilityResult, maximumEndsOn } = useOfficeAvailability({
    initialAvailability,
    replacementToken,
    today,
  });
  const advertisedPriceRequests = useMemo(
    () =>
      selection
        ? getOfficeSeatAdvertisedPriceRequests({
            seatCapacity,
            locale,
            startsOn: selection.startsOn,
            endsOn: selection.endsOn,
            submittedCode,
          })
        : [],
    [seatCapacity, locale, selection, submittedCode]
  );
  const advertisedPrices = useAdvertisedOptionPrices({
    family: officeSeatOptions,
    initialAdvertisedPrices,
    productLabel: getWorkspaceOfficeProductTitle(locale),
    requests: advertisedPriceRequests,
    selected: findOfficeSeatAdvertisedPriceRequest(
      advertisedPriceRequests,
      seats
    ),
  });
  const advertisedOfficeQuoteItem =
    advertisedPrices.selectedPrice?.quote.items[0];
  const advertisedTotal = advertisedPrices.checkout.total;
  const { availability, maximumDayCount, unavailableDates } =
    useOfficeDayCountBounds({
      availabilityResult,
      form,
      locale,
      maximumEndsOn,
      selection: watchedSelection,
    });
  const basePriceLabel = selection
    ? m.reservationOfficeBasePriceLabel(
        { dayCount: getOfficeReservationDayCount(selection) },
        { locale }
      )
    : getWorkspaceOfficeProductTitle(locale);

  return (
    <ReservationCheckoutForm<OfficeReservationFormValues, OfficeReservationData>
      checkoutCustomer={checkoutCustomer}
      advertisedPrice={advertisedPrices.checkout}
      availability={availability}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getOfficeReservationOrder}
      locale={locale}
      selectionSummary={getOfficeReservationSelectionSummary(
        { startsOn, dayCount, seats },
        locale
      )}
      selection={{
        kind: officeSelectionLink.kind,
        // Seats follow the people list, so a link's seat count picks nothing.
        fromSearchParams: (
          searchParams
        ): Partial<OfficeReservationFormValues> => {
          const { seats: _seats, ...linkedSelection } =
            officeSelectionLink.readSelection(searchParams, {
              seatCapacity,
              today,
            });
          return linkedSelection;
        },
      }}
    >
      <fieldset className="flex flex-col gap-y-2">
        <legend className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72 after:content-['_*']">
          {m.reservationOfficeDateRangeLabel({}, { locale })}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startsOn"
            render={({ field }) => (
              <FormItem>
                <ReservationFormLabel required>
                  {m.reservationOfficeStartDateLabel({}, { locale })}
                </ReservationFormLabel>
                <ReservationFormDateInput
                  {...field}
                  label={m.reservationOfficeStartDateLabel({}, { locale })}
                  locale={locale}
                  maximum={maximumEndsOn}
                  minimum={today}
                  unavailableDates={unavailableDates}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dayCount"
            render={({ field, fieldState }) => (
              <FormItem>
                <ReservationFormLabel required>
                  {m.reservationOfficeDayCountLabel({}, { locale })}
                </ReservationFormLabel>
                <FormControl>
                  <OfficeDayCountInput
                    disabled={maximumDayCount === 0}
                    maximum={Math.max(1, maximumDayCount)}
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    ref={field.ref}
                    value={field.value}
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </fieldset>

      <div className="@container">
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <FormField
            control={form.control}
            name="people"
            render={({ field, fieldState }) => (
              <OfficePeopleField
                contact={
                  contactEmail
                    ? { name: contactName, email: contactEmail }
                    : undefined
                }
                error={
                  fieldState.error?.type ===
                  officeInviteeRejectedErrorType.contact
                    ? undefined
                    : fieldState.error?.message
                }
                inputRef={field.ref}
                labelId={peopleLabelId}
                locale={locale}
                onChange={(people) => {
                  field.onChange(people);
                  form.setValue("seats", getOfficePeopleSeats(people), {
                    shouldDirty: true,
                  });
                }}
                people={field.value}
                seatCapacity={seatCapacity}
              />
            )}
          />

          <div className="flex flex-col gap-2" data-office-price="">
            <span className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
              {m.officePeoplePriceLabel({}, { locale })}
            </span>
            <dl className="rounded-[1.4rem] border border-aquamarine-green/25 bg-aquamarine-green/8 px-5 py-4 text-navy-blue">
              <div
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1"
                data-office-base-price=""
              >
                <dt className="font-semibold">{basePriceLabel}</dt>
                <dd>
                  {advertisedOfficeQuoteItem ? (
                    <ReservationAdvertisedPrice
                      amount={advertisedOfficeQuoteItem.accessAmount}
                      className="font-semibold"
                      locale={locale}
                    />
                  ) : (
                    <ReservationSkeletonBlock className="h-5 w-20 bg-aquamarine-green/15" />
                  )}
                </dd>
              </div>
              <div
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1"
                data-office-seats-price=""
              >
                <dt className="font-semibold">
                  {advertisedOfficeQuoteItem ? (
                    m.officePeoplePriceSeatLine(
                      {
                        count: seats,
                        seatPrice: formatMoney(
                          advertisedOfficeQuoteItem.seatAmount,
                          locale
                        ),
                      },
                      { locale }
                    )
                  ) : (
                    <ReservationSkeletonBlock className="h-5 w-32 bg-aquamarine-green/15" />
                  )}
                </dt>
                <dd>
                  {advertisedOfficeQuoteItem && (
                    <ReservationAdvertisedPrice
                      amount={getOfficeSeatsAmount({
                        seatAmount: advertisedOfficeQuoteItem.seatAmount,
                        seats,
                      })}
                      className="font-semibold"
                      locale={locale}
                    />
                  )}
                </dd>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-aquamarine-green/30 pt-3">
                <dt className="text-xl font-bold">
                  {m.officePeoplePriceTotal({}, { locale })}
                </dt>
                <dd>
                  {advertisedTotal ? (
                    <ReservationAdvertisedPrice
                      {...advertisedTotal}
                      className="text-xl font-bold"
                      locale={locale}
                    />
                  ) : (
                    <ReservationSkeletonBlock className="h-6 w-24 bg-aquamarine-green/15" />
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </ReservationCheckoutForm>
  );
}

export function OfficeReservationFormFallback({ locale }: { locale: Locale }) {
  return (
    <ReservationFormFallback
      label={m.reservationOfficeFormTitle({}, { locale })}
    >
      <div className="flex flex-col gap-y-2">
        <ReservationSkeletonBlock className="h-4 w-40" />
        <div className="grid gap-3 sm:grid-cols-2">
          <ReservationSkeletonField />
          <ReservationSkeletonField />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-2" data-office-people-fallback="">
          <ReservationSkeletonBlock className="h-4 w-40" />
          <ReservationSkeletonBlock className="h-44 w-full rounded-[1.4rem]" />
        </div>
        <div className="space-y-2">
          <ReservationSkeletonBlock className="h-4 w-20" />
          <ReservationSkeletonBlock className="h-36 w-full rounded-[1.4rem] bg-aquamarine-green/15" />
        </div>
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
