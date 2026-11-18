import type { CustomerBookedSelection } from "@deskohub/workspace-customer-api";
import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/reactivity";
import { Stack, useRouter } from "expo-router";
import KeyRound from "lucide-react-native/icons/key-round";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { LiveMessage } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { ListGroup } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import { color, radius, shadow, space } from "../../ui/tokens";
import { useViewport } from "../../ui/viewport";
import { bookingPreselectionKey } from "../booking-preselection";
import { bookCheckoutHref } from "../booking-routes";
import { checkoutRequestAtom } from "../checkout/checkout-flow";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
} from "../data/booking-queries";
import { BookingCatalogViewError } from "../data/booking-query-error";
import {
  type OfficeBlocker,
  type OfficeDraft,
  type OfficeOffering,
  officeAvailabilityQuery,
  selectOfficeDate,
} from "../selection/office-selection";
import { pragueToday } from "../selection/prague-date";
import { BookingBar, type BookingBarSummary } from "../ui/booking-bar";
import { BookingSectionHeading } from "../ui/booking-section-heading";
import { BookingStepLayout } from "../ui/booking-step-layout";
import { MonthCalendar } from "../ui/month-calendar";
import { formatShortPragueDate } from "../ui/prague-date-format";
import { describeOfficePriceLine } from "../ui/price-line-description";
import { SpaceIllustration } from "../ui/space-illustration";
import { Stepper } from "../ui/stepper";
import { bookingClockAtom } from "./booking-clock";
import { unneededReadAtom } from "./booking-family-atoms";
import {
  availabilityNoticeMessage,
  bookingQueryMessage,
} from "./booking-family-copy";
import {
  useBookingPreselection,
  useBookingStarted,
  useRestartReason,
} from "./booking-family-hooks";
import {
  type BookingRead,
  bookingReadOf,
  checkoutRequestOf,
  freshValue,
  loadedValue,
  quoteFailureRepeats,
  readValue,
} from "./booking-family-view";
import { BookingGate } from "./booking-gate";
import { BookingReadFailure, BookingReadView } from "./booking-read-view";
import { chooseStyles, useChooseTracks } from "./choose-layout";
import {
  type KeptOfficeDraft,
  type OfficeSteppers,
  officeBookingModel,
  officeFromPrice,
  officeOfferingOf,
  openingOfficeDraft,
} from "./office-booking-model";
import { RestartNotice } from "./restart-notice";
import { selectionBar } from "./selection-bar";

/**
 * The customer's office draft, with the preselection it grew from; none
 * until they change what the screen opened with.
 */
const officeDraftAtom = Atom.make(Option.none<KeptOfficeDraft>());

const blockerMessage = (blocker: OfficeBlocker, locale: AppLocale) =>
  ({
    DateRequired: () => m.booking_office_reason_date({}, { locale }),
    AvailabilityPending: () => undefined,
    DateUnavailable: () => m.booking_office_date_unavailable({}, { locale }),
    DayCountUnavailable: () =>
      m.booking_office_day_count_unavailable({}, { locale }),
    SeatsUnavailable: () => m.booking_office_seats_unavailable({}, { locale }),
  })[blocker._tag]();

/**
 * Office: a first day, then days and seats; opened empty or on a booked
 * selection ("Book again").
 */
export function OfficeBookingScreen() {
  useBookingStarted("office");
  const preselection = useBookingPreselection("office");
  return (
    <View style={styles.screen}>
      <BookingGate>
        <OfficeCatalog preselection={preselection} />
      </BookingGate>
    </View>
  );
}

function OfficeCatalog({
  preselection,
}: {
  readonly preselection: Option.Option<CustomerBookedSelection>;
}) {
  const locale = useAppLocale();
  const catalogAtom = bookingOfferingsAtom(locale);
  const read = bookingReadOf(useAtomValue(catalogAtom));
  const refresh = useAtomRefresh(catalogAtom);
  const offering = Option.flatMap(readValue(read), (catalog) =>
    officeOfferingOf(catalog.offerings)
  );
  if (Option.isSome(offering)) {
    return (
      <OfficeSelection
        offering={offering.value}
        catalog={read}
        onRetryCatalog={refresh}
        preselection={preselection}
      />
    );
  }
  // Loaded without an office: the office isn't offered now.
  const unoffered = read.kind === "loaded";
  return (
    <BookingStepLayout
      step="choose"
      locale={locale}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: m.booking_family_office_title({}, { locale }),
            price: { kind: "none" },
          }}
          action={{
            label: m.booking_continue({}, { locale }),
            onPress: () => undefined,
            disabled: true,
          }}
        />
      }
    >
      <BookingReadView read={read} onRetry={refresh}>
        {() => (
          <Notice
            tone="warning"
            message={
              unoffered
                ? bookingQueryMessage(
                    BookingCatalogViewError.OfferingUnavailable({
                      family: "office",
                    }),
                    locale
                  )
                : undefined
            }
          />
        )}
      </BookingReadView>
    </BookingStepLayout>
  );
}

function OfficeSelection({
  offering,
  catalog,
  onRetryCatalog,
  preselection,
}: {
  readonly offering: OfficeOffering;
  readonly catalog: BookingRead<unknown>;
  readonly onRetryCatalog: () => void;
  readonly preselection: Option.Option<CustomerBookedSelection>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const setCheckoutRequest = useAtomSet(checkoutRequestAtom);
  const now = useAtomValue(bookingClockAtom);
  const today = pragueToday(now);

  const seed = bookingPreselectionKey(preselection);
  const [kept, setStored] = useAtom(officeDraftAtom);
  const draft = openingOfficeDraft({
    kept,
    preselection,
    bookableDates: offering.bookableDates,
  });
  const setDraft = (next: OfficeDraft) =>
    setStored(Option.some({ seed, draft: next }));

  const availabilityAtom = bookingAvailabilityAtom({
    query: officeAvailabilityQuery(offering.bookableDates),
  });
  const availabilityRead = bookingReadOf(useAtomValue(availabilityAtom));
  const refreshAvailability = useAtomRefresh(availabilityAtom);

  const model = officeBookingModel({
    draft,
    offering,
    availability: loadedValue(availabilityRead),
  });
  const { enablement } = model;

  const quoteAtom = Option.match(model.quotable, {
    onNone: () => unneededReadAtom,
    onSome: (selection) => bookingQuoteAtom(selection, locale),
  });
  const quoteResult = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const quote = Option.map(model.quotable, () => bookingReadOf(quoteResult));

  const supportingReads = [availabilityRead];
  const quoteRepeats = quoteFailureRepeats(quote, supportingReads, (error) =>
    bookingQueryMessage(error, locale)
  );
  const retrySupportingReads = () => {
    refreshAvailability();
    if (quoteRepeats) refreshQuote();
  };

  const { name } = offering;
  const tracks = useChooseTracks(2);
  const { isWide } = useViewport();
  const chosenDate = Option.getOrUndefined(model.draft.date);
  const blocked = enablement.blockers.flatMap((blocker) => {
    const message = blockerMessage(blocker, locale);
    return message === undefined ? [] : [message];
  });
  const checkout = checkoutRequestOf({
    locale,
    selection: model.selection,
    blockers: enablement.blockers,
    quote: Option.flatMap(quote, freshValue),
  });
  const failedQuote = Option.getOrUndefined(quote);
  const quoteFailure =
    failedQuote?.kind === "failed" && !quoteRepeats ? failedQuote : undefined;

  const bar = selectionBar({
    from: {
      title: name,
      amount: offering.advertisedPrice.price,
      unit: m.booking_price_unit_per_day_one_seat({}, { locale }),
    },
    selection: model.selection,
    quote,
    blocked: Option.fromNullishOr(blocked[0]),
    canContinue: Option.isSome(checkout),
    locale,
  });
  // Before a first day the from-price opens to the lines it adds up from.
  const summary: BookingBarSummary =
    bar.summary.price.kind === "from"
      ? {
          ...bar.summary,
          price: {
            ...bar.summary.price,
            ...Option.match(officeFromPrice(offering), {
              onNone: () => ({}),
              onSome: (breakdown) => ({
                itemized: {
                  breakdown,
                  describeLine: describeOfficePriceLine(locale, name),
                },
              }),
            }),
          },
        }
      : bar.summary;
  const steppers = Option.getOrUndefined(model.steppers);
  const range =
    steppers === undefined || chosenDate === undefined
      ? undefined
      : { start: chosenDate, end: steppers.days.lastDate };

  return (
    <BookingStepLayout
      step="choose"
      locale={locale}
      bar={
        <BookingBar
          locale={locale}
          summary={summary}
          action={
            bar.action === "retry"
              ? {
                  label: m.booking_checkout_retry({}, { locale }),
                  icon: RotateCcw,
                  onPress: refreshQuote,
                  disabled: bar.disabled,
                }
              : {
                  label: m.booking_continue({}, { locale }),
                  disabled: bar.disabled,
                  onPress: () =>
                    Option.map(checkout, (request) => {
                      setCheckoutRequest(Option.some(request));
                      router.push(bookCheckoutHref);
                    }),
                }
          }
          reason={bar.reason}
        />
      }
    >
      <Stack.Screen options={{ title: name }} />
      <BookingReadView read={catalog} onRetry={onRetryCatalog}>
        {() => (
          <>
            <OfficeRestartNotice
              onReread={() => {
                refreshAvailability();
                refreshQuote();
              }}
            />
            <Notice
              tone="error"
              title={
                quoteFailure === undefined
                  ? undefined
                  : m.booking_quote_failed_title({}, { locale })
              }
              message={
                quoteFailure === undefined
                  ? undefined
                  : bookingQueryMessage(quoteFailure.error, locale)
              }
            />
            <BookingReadFailure
              reads={supportingReads}
              onRetry={retrySupportingReads}
            />

            {isWide && (
              <OfficeBookingHero
                description={offering.description}
                inline={tracks}
                locale={locale}
              />
            )}
            <View style={tracks && chooseStyles.row}>
              <View style={tracks && chooseStyles.officeCalendar}>
                <BookingSectionHeading
                  title={m.booking_office_first_day_heading({}, { locale })}
                  first={!isWide || tracks}
                />
                <MonthCalendar
                  stretch={tracks}
                  label={m.booking_office_first_day_heading({}, { locale })}
                  locale={locale}
                  dates={enablement.dates}
                  selected={chosenDate}
                  onSelect={(date) =>
                    setDraft(selectOfficeDate(model.draft, date))
                  }
                  today={today}
                  range={range}
                  legend={chosenDate === undefined}
                  previousMonthLabel={m.booking_calendar_previous_month(
                    {},
                    { locale }
                  )}
                  nextMonthLabel={m.booking_calendar_next_month({}, { locale })}
                  unavailableLabel={m.booking_calendar_unavailable_day(
                    {},
                    { locale }
                  )}
                />
                <View style={styles.after}>
                  <Notice
                    tone="info"
                    message={
                      enablement.notices
                        .map((notice) =>
                          availabilityNoticeMessage(notice, locale)
                        )
                        .join(" ") || undefined
                    }
                  />
                </View>
              </View>
              {steppers !== undefined && (
                <View style={tracks && chooseStyles.track}>
                  <BookingSectionHeading
                    first={tracks}
                    title={m.booking_office_days_and_seats_heading(
                      {},
                      { locale }
                    )}
                  />
                  <OfficeStayControls
                    steppers={steppers}
                    draft={model.draft}
                    onChange={setDraft}
                    locale={locale}
                  />
                </View>
              )}
            </View>

            <LiveMessage
              role="status"
              message={
                enablement.blockers.some(
                  ({ _tag }) => _tag === "AvailabilityPending"
                )
                  ? m.booking_availability_loading({}, { locale })
                  : undefined
              }
            />
          </>
        )}
      </BookingReadView>
    </BookingStepLayout>
  );
}

/**
 * The days and seats steppers on one card: days name the stay's last day;
 * seats say how many the office takes, in warning ink once the draft has
 * them all.
 */
export function OfficeStayControls({
  steppers: { days, seats },
  draft,
  onChange,
  locale,
}: {
  readonly steppers: OfficeSteppers;
  readonly draft: OfficeDraft;
  readonly onChange: (draft: OfficeDraft) => void;
  readonly locale: AppLocale;
}) {
  const until = m.booking_office_until(
    { date: formatShortPragueDate(days.lastDate, locale) },
    { locale }
  );
  const seatsHint = Option.map(seats.maximum, (count) =>
    seats.reached
      ? m.booking_office_seats_maximum({ count }, { locale })
      : m.booking_office_seats_up_to({ count }, { locale })
  );
  return (
    <ListGroup>
      <Stepper
        key="days"
        label={m.booking_office_days_label({}, { locale })}
        hint={until}
        value={draft.dayCount}
        min={1}
        max={days.maximum}
        onChange={(dayCount) => onChange({ ...draft, dayCount })}
        decrementLabel={m.booking_office_days_decrease({}, { locale })}
        incrementLabel={m.booking_office_days_increase({}, { locale })}
      />
      <Stepper
        key="seats"
        label={m.booking_office_seats_label({}, { locale })}
        hint={Option.getOrUndefined(seatsHint)}
        hintTone={seats.reached ? "warning" : "muted"}
        value={draft.seats}
        min={1}
        max={Option.getOrElse(seats.maximum, () => draft.seats)}
        onChange={(count) => onChange({ ...draft, seats: count })}
        decrementLabel={m.booking_office_seats_decrease({}, { locale })}
        incrementLabel={m.booking_office_seats_increase({}, { locale })}
      />
    </ListGroup>
  );
}

/**
 * Why checkout sent the customer back, read inside the step's scroll view,
 * so a restart scrolls it back to the top where this notice says why.
 */
function OfficeBookingHero({
  description,
  inline,
  locale,
}: {
  readonly description: string;
  readonly inline: boolean;
  readonly locale: AppLocale;
}) {
  const access = (
    <View style={[styles.access, inline && styles.inlineAccess]}>
      <Icon icon={KeyRound} size={16} color={color.ink2} />
      <Text variant="hint" tone="muted" style={styles.accessText}>
        {m.booking_space_always_open({}, { locale })}
      </Text>
    </View>
  );
  if (inline) return access;
  return (
    <View style={styles.hero}>
      <SpaceIllustration family="office" height={132} span="full" />
      <View style={styles.heroText}>
        <Text variant="bodySmall">{description}</Text>
        {access}
      </View>
    </View>
  );
}

function OfficeRestartNotice({ onReread }: { readonly onReread: () => void }) {
  return <RestartNotice reason={useRestartReason(onReread)} />;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  after: { marginTop: space.md },
  hero: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: "hidden",
    ...shadow.group,
  },
  heroText: { gap: space.sm, padding: space.lg },
  access: { alignItems: "center", flexDirection: "row", gap: space.xs },
  accessText: { flexShrink: 1 },
  inlineAccess: { justifyContent: "flex-end", paddingBottom: space.sm },
});
