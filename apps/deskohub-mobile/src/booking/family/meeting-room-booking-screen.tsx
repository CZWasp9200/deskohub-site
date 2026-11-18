import type {
  CustomerBookedSelection,
  CustomerMeetingRoomDuration,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/reactivity";
import { Stack, useRouter } from "expo-router";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { CheckboxRow } from "../../ui/checkbox";
import { LiveMessage } from "../../ui/controls";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import { contentColumnWidth, useViewport, wideGutter } from "../../ui/viewport";
import { bookingPreselectionKey } from "../booking-preselection";
import { bookCheckoutHref } from "../booking-routes";
import { checkoutRequestAtom } from "../checkout/checkout-flow";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
  meetingRoomStartTimesAtom,
  meetingRoomUnavailableDatesAtom,
} from "../data/booking-queries";
import {
  type MeetingRoomAlternatives,
  type MeetingRoomBlocker,
  meetingRoomOfferings,
  meetingRoomStartTimesQuery,
  selectMeetingRoomDate,
  selectMeetingRoomDuration,
  selectMeetingRoomStartTime,
} from "../selection/meeting-room-selection";
import type { PragueDate } from "../selection/prague-date";
import { pragueToday } from "../selection/prague-date";
import { BookingBar, type BookingBarSummary } from "../ui/booking-bar";
import { BookingSectionHeading } from "../ui/booking-section-heading";
import { BookingStepLayout } from "../ui/booking-step-layout";
import { MonthCalendar } from "../ui/month-calendar";
import {
  formatPragueTime,
  formatShortPragueDate,
} from "../ui/prague-date-format";
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
  type KeptMeetingRoomDraft,
  meetingRoomBookingModel,
  meetingRoomQueryOf,
  openingMeetingRoomDraft,
} from "./meeting-room-booking-model";
import { MeetingRoomHero } from "./meeting-room-hero";
import { MeetingRoomLengths } from "./meeting-room-lengths";
import { MeetingRoomNoneLeft } from "./meeting-room-none-left";
import { MeetingRoomStartTimes } from "./meeting-room-start-times";
import { RestartNotice } from "./restart-notice";
import { selectionBar } from "./selection-bar";

/**
 * The customer's meeting-room draft, with the preselection it grew from;
 * none until they change what the screen opened with.
 */
const meetingRoomDraftAtom = Atom.make(Option.none<KeptMeetingRoomDraft>());

/**
 * The draft the starts and availability are read for: the customer's once
 * it has stayed unchanged for 250 ms, as on the site.
 */
const settledMeetingRoomDraftAtom = Atom.debounce(
  meetingRoomDraftAtom,
  "250 millis"
);

const blockerMessage = (blocker: MeetingRoomBlocker, locale: AppLocale) =>
  ({
    DateRequired: () => m.booking_meeting_room_reason_date({}, { locale }),
    DateOutOfRange: () => m.booking_error_date_out_of_range({}, { locale }),
    DurationRequired: () =>
      m.booking_meeting_room_reason_length({}, { locale }),
    AvailabilityPending: () => undefined,
    NoFreeStart: () => m.booking_meeting_room_reason_start({}, { locale }),
    StartRequired: () => m.booking_meeting_room_reason_start({}, { locale }),
    StartUnavailable: () =>
      m.booking_meeting_room_start_unavailable({}, { locale }),
  })[blocker._tag]();

/** "13:45" for a 14:00 start: when the room opens for early setup. */
const earlySetupTime = (startTime: string) => {
  const minutes =
    Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5)) - 15;
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

/**
 * Meeting room: a date, then a length, then a start for the hourly lengths,
 * with early setup; opened empty or on a booked selection ("Book again").
 */
export function MeetingRoomBookingScreen() {
  useBookingStarted("meeting-room");
  const preselection = useBookingPreselection("meeting-room");
  return (
    <View style={styles.screen}>
      <BookingGate>
        <MeetingRoomCatalog preselection={preselection} />
      </BookingGate>
    </View>
  );
}

function MeetingRoomCatalog({
  preselection,
}: {
  readonly preselection: Option.Option<CustomerBookedSelection>;
}) {
  const locale = useAppLocale();
  const catalogAtom = bookingOfferingsAtom(locale);
  const read = bookingReadOf(useAtomValue(catalogAtom));
  const refresh = useAtomRefresh(catalogAtom);
  const offerings = Option.map(readValue(read), (catalog) =>
    meetingRoomOfferings(catalog.offerings)
  );
  const [first, ...rest] = Option.getOrElse(offerings, () => []);
  if (first !== undefined) {
    return (
      <MeetingRoomSelection
        offerings={[first, ...rest]}
        catalog={read}
        onRetryCatalog={refresh}
        preselection={preselection}
      />
    );
  }
  return (
    <BookingStepLayout
      step="choose"
      locale={locale}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: m.booking_family_meeting_room_title({}, { locale }),
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
        {() => null}
      </BookingReadView>
    </BookingStepLayout>
  );
}

type MeetingRoomOffering = ReturnType<typeof meetingRoomOfferings>[number];

function MeetingRoomSelection({
  offerings,
  catalog,
  onRetryCatalog,
  preselection,
}: {
  /** The meeting-room offerings, one per length; never empty. */
  readonly offerings: readonly [MeetingRoomOffering, ...MeetingRoomOffering[]];
  readonly catalog: BookingRead<unknown>;
  readonly onRetryCatalog: () => void;
  readonly preselection: Option.Option<CustomerBookedSelection>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const setCheckoutRequest = useAtomSet(checkoutRequestAtom);
  const now = useAtomValue(bookingClockAtom);
  const today = pragueToday(now);
  const allOfferings: ReadonlyArray<CustomerOffering> = offerings;
  // The meeting-room offerings share one bookable window.
  const { bookableDates } = offerings[0];

  const seed = bookingPreselectionKey(preselection);
  const [kept, setStored] = useAtom(meetingRoomDraftAtom);
  const draft = openingMeetingRoomDraft({
    kept,
    preselection,
    offerings: allOfferings,
    bookableDates,
  });
  const settled = openingMeetingRoomDraft({
    kept: useAtomValue(settledMeetingRoomDraftAtom),
    preselection,
    offerings: allOfferings,
    bookableDates,
  });
  const setDraft = (next: typeof draft) =>
    setStored(Option.some({ seed, draft: next }));

  const calendarAtom = meetingRoomUnavailableDatesAtom;
  const calendarRead = bookingReadOf(useAtomValue(calendarAtom));
  const refreshCalendar = useAtomRefresh(calendarAtom);

  const startTimesAtom = Option.match(meetingRoomStartTimesQuery(settled), {
    onNone: () => unneededReadAtom,
    onSome: (query) => meetingRoomStartTimesAtom(query),
  });
  const startTimesRead = bookingReadOf(useAtomValue(startTimesAtom));
  const refreshStartTimes = useAtomRefresh(startTimesAtom);
  const startTimes = readValue(startTimesRead);

  const query = meetingRoomQueryOf(settled, startTimes, now);
  const availabilityAtom = Option.match(query, {
    onNone: () => unneededReadAtom,
    onSome: (wanted) => bookingAvailabilityAtom({ query: wanted }),
  });
  const availabilityRead = bookingReadOf(useAtomValue(availabilityAtom));
  const refreshAvailability = useAtomRefresh(availabilityAtom);

  const model = meetingRoomBookingModel({
    draft,
    settled,
    now,
    offerings: allOfferings,
    bookableDates,
    startTimes,
    calendar: readValue(calendarRead),
    availability: Option.flatMap(query, (answered) =>
      Option.map(loadedValue(availabilityRead), (value) => ({
        query: answered,
        value,
      }))
    ),
  });
  const { enablement } = model;

  const quoteAtom = Option.match(model.quotable, {
    onNone: () => unneededReadAtom,
    onSome: (selection) =>
      bookingQuoteAtom(selection, locale, {
        earlySetup: model.draft.earlySetup,
      }),
  });
  const quoteResult = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const quote = Option.map(model.quotable, () => bookingReadOf(quoteResult));

  const rereadAvailability = () => {
    refreshCalendar();
    refreshStartTimes();
    refreshAvailability();
  };
  const supportingReads = [calendarRead, startTimesRead, availabilityRead];
  const quoteRepeats = quoteFailureRepeats(quote, supportingReads, (error) =>
    bookingQueryMessage(error, locale)
  );
  const retrySupportingReads = () => {
    rereadAvailability();
    if (quoteRepeats) refreshQuote();
  };

  const [first] = offerings;
  const { name, facts } = first;
  const lengthOf = (duration: CustomerMeetingRoomDuration) =>
    offerings.find((offering) => offering.duration === duration);
  const lengthLabel = (duration: CustomerMeetingRoomDuration) =>
    lengthOf(duration)?.durationLabel ?? duration;
  const shortDate = (date: PragueDate) => formatShortPragueDate(date, locale);
  const tracks = useChooseTracks(3);
  const { availableWidth, fontScale, isWide } = useViewport();
  const columnWidth = Math.min(
    availableWidth - 2 * wideGutter,
    contentColumnWidth.wide
  );
  const durationRow =
    isWide && !tracks && (columnWidth - 2 * space.sm) / (3 * fontScale) >= 152;
  const stackedStartColumns = isWide ? 5 : 4;
  const chosenDate = Option.getOrUndefined(model.draft.date);
  const chosenDuration = Option.getOrUndefined(model.draft.duration);
  const chosenStart = Option.getOrUndefined(model.draft.startTime);
  const hourly = chosenDuration !== undefined && chosenDuration !== "day:1";

  const blocked = enablement.blockers.flatMap((blocker) => {
    const message = blockerMessage(blocker, locale);
    return message === undefined ? [] : [message];
  });
  const checkout = checkoutRequestOf({
    locale,
    selection: model.selection,
    blockers: enablement.blockers,
    quote: Option.flatMap(quote, freshValue),
    earlySetup: model.draft.earlySetup,
  });
  const failedQuote = Option.getOrUndefined(quote);
  const quoteFailure =
    failedQuote?.kind === "failed" && !quoteRepeats ? failedQuote : undefined;

  // Before a length: the hourly price. Once a date and a length are chosen,
  // that length's price under the date, until the start completes it.
  const hourOffering = lengthOf("hour:1") ?? first;
  const chosenOffering =
    chosenDuration === undefined ? undefined : lengthOf(chosenDuration);
  const bar = selectionBar({
    from: {
      title: name,
      amount: hourOffering.advertisedPrice.price,
      unit:
        hourOffering.duration === "hour:1"
          ? m.booking_price_unit_per_hour({}, { locale })
          : hourOffering.durationLabel,
    },
    selection: model.selection,
    quote,
    blocked: Option.fromNullishOr(blocked[0]),
    canContinue: Option.isSome(checkout),
    locale,
  });
  const detail = barDetail({
    name,
    chosenDate,
    chosenDuration,
    earlyFrom:
      model.draft.earlySetup && chosenStart !== undefined
        ? formatPragueTime(earlySetupTime(chosenStart), locale)
        : undefined,
    lengthLabel,
    locale,
  });
  // Until the selection is complete the bar names the chosen date, and a
  // chosen length's own price.
  const incomplete = Option.isNone(model.selection);
  const summary: BookingBarSummary = {
    ...bar.summary,
    ...(incomplete &&
      chosenDate !== undefined && { title: shortDate(chosenDate) }),
    ...(detail !== undefined && { detail }),
    ...(incomplete &&
      chosenDate !== undefined &&
      chosenOffering !== undefined && {
        price: { kind: "from", amount: chosenOffering.advertisedPrice.price },
      }),
  };

  const alternatives = Option.getOrUndefined(enablement.alternatives);
  const startChoices = Option.getOrUndefined(enablement.startChoices);
  const noneLeft =
    chosenDate !== undefined &&
    chosenDuration !== undefined &&
    enablement.blockers.some(({ _tag }) => _tag === "NoFreeStart")
      ? { date: chosenDate, duration: chosenDuration }
      : undefined;

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
            <MeetingRoomRestartNotice
              onReread={() => {
                rereadAvailability();
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

            <MeetingRoomHero
              facts={
                isWide ? facts.filter(({ kind }) => kind === "capacity") : facts
              }
              inline={tracks}
            />

            <View style={tracks && chooseStyles.row}>
              <View style={tracks && chooseStyles.meetingCalendar}>
                <BookingSectionHeading
                  title={m.booking_date_heading({}, { locale })}
                  first={tracks}
                />
                <MonthCalendar
                  stretch={tracks}
                  label={m.booking_date_heading({}, { locale })}
                  locale={locale}
                  dates={enablement.dates}
                  selected={chosenDate}
                  onSelect={(date) =>
                    setDraft(selectMeetingRoomDate(model.draft, date))
                  }
                  today={today}
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
              {chosenDate !== undefined && (
                <View style={tracks && chooseStyles.track}>
                  <BookingSectionHeading
                    first={tracks}
                    title={m.booking_meeting_room_duration_heading(
                      {},
                      { locale }
                    )}
                    aside={shortDate(chosenDate)}
                  />
                  <MeetingRoomLengths
                    label={m.booking_meeting_room_duration_heading(
                      {},
                      { locale }
                    )}
                    lengths={offerings.map((offering) => ({
                      duration: offering.duration,
                      label: offering.durationLabel,
                      price: offering.advertisedPrice.price,
                      ...(offering.advertisedPrice.discount.value > 0 && {
                        was: offering.price,
                      }),
                    }))}
                    cards={tracks || durationRow}
                    horizontal={durationRow}
                    selected={chosenDuration}
                    onSelect={(duration) =>
                      setDraft(selectMeetingRoomDuration(model.draft, duration))
                    }
                    locale={locale}
                  />
                </View>
              )}

              {((chosenDate !== undefined && hourly) ||
                noneLeft !== undefined) && (
                <View style={tracks && chooseStyles.track}>
                  {chosenDate !== undefined && hourly && (
                    <BookingSectionHeading
                      title={m.booking_meeting_room_start_heading(
                        {},
                        { locale }
                      )}
                      first={tracks}
                    />
                  )}
                  {noneLeft !== undefined ? (
                    <View style={hourly ? undefined : styles.after}>
                      <MeetingRoomNoneLeft
                        title={m.booking_meeting_room_none_left(
                          {
                            length: lengthLabel(noneLeft.duration),
                            date: shortDate(noneLeft.date),
                          },
                          { locale }
                        )}
                        body={noneLeftBody({
                          alternatives,
                          length: lengthLabel(noneLeft.duration),
                          lengthLabel,
                          shortDate,
                          locale,
                        })}
                        actions={[
                          ...(alternatives?.durations[0] === undefined
                            ? []
                            : [alternatives.durations[0]].map((other) => ({
                                label: m.booking_meeting_room_switch_length(
                                  { length: lengthLabel(other) },
                                  { locale }
                                ),
                                onPress: () =>
                                  setDraft(
                                    selectMeetingRoomDuration(
                                      model.draft,
                                      other
                                    )
                                  ),
                              }))),
                          ...Option.match(
                            alternatives?.nextDate ?? Option.none(),
                            {
                              onNone: () => [],
                              onSome: (next: PragueDate) => [
                                {
                                  label: m.booking_meeting_room_go_to_day(
                                    { date: shortDate(next) },
                                    { locale }
                                  ),
                                  onPress: () =>
                                    setDraft(
                                      selectMeetingRoomDate(model.draft, next)
                                    ),
                                },
                              ],
                            }
                          ),
                        ]}
                      />
                    </View>
                  ) : (
                    chosenDate !== undefined &&
                    hourly &&
                    (startChoices === undefined ? (
                      <View style={styles.loading}>
                        <LoadingIndicator
                          size="section"
                          tone="brand"
                          label={m.booking_availability_loading({}, { locale })}
                        />
                      </View>
                    ) : (
                      <MeetingRoomStartTimes
                        label={m.booking_meeting_room_start_heading(
                          {},
                          { locale }
                        )}
                        daytime={startChoices.daytime}
                        maxColumns={tracks ? 2 : stackedStartColumns}
                        outside={startChoices.outside}
                        selected={chosenStart}
                        onSelect={(startTime) =>
                          setDraft(
                            selectMeetingRoomStartTime(model.draft, startTime)
                          )
                        }
                        locale={locale}
                      />
                    ))
                  )}

                  {hourly &&
                    chosenStart !== undefined &&
                    noneLeft === undefined && (
                      <View style={styles.earlySetup}>
                        <CheckboxRow
                          label={m.booking_meeting_room_early_setup(
                            {},
                            { locale }
                          )}
                          checked={model.draft.earlySetup}
                          disabled={!enablement.earlySetupAvailable}
                          onChange={(earlySetup) =>
                            setDraft({ ...model.draft, earlySetup })
                          }
                        />
                        {!enablement.earlySetupAvailable && (
                          <Text variant="hint" style={styles.earlySetupReason}>
                            {m.booking_meeting_room_early_setup_unavailable(
                              {},
                              { locale }
                            )}
                          </Text>
                        )}
                      </View>
                    )}
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
 * The bar's grey line once a date is chosen: one product name, the
 * catalog's, with the length or, with early setup, when the room opens.
 */
const barDetail = ({
  name,
  chosenDate,
  chosenDuration,
  earlyFrom,
  lengthLabel,
  locale,
}: {
  readonly name: string;
  readonly chosenDate: PragueDate | undefined;
  readonly chosenDuration: CustomerMeetingRoomDuration | undefined;
  /** When the room opens for early setup; none without it. */
  readonly earlyFrom: string | undefined;
  readonly lengthLabel: (duration: CustomerMeetingRoomDuration) => string;
  readonly locale: AppLocale;
}) => {
  if (chosenDate === undefined) return undefined;
  if (chosenDuration === undefined || chosenDuration === "day:1") return name;
  if (earlyFrom !== undefined) {
    return `${name} · ${m.booking_meeting_room_in_from({ time: earlyFrom }, { locale })}`;
  }
  return `${name} · ${lengthLabel(chosenDuration)}`;
};

/** What the "nothing left" box says is still free. */
const noneLeftBody = ({
  alternatives,
  length,
  lengthLabel,
  shortDate,
  locale,
}: {
  readonly alternatives: MeetingRoomAlternatives | undefined;
  readonly length: string;
  readonly lengthLabel: (duration: CustomerMeetingRoomDuration) => string;
  readonly shortDate: (date: PragueDate) => string;
  readonly locale: AppLocale;
}) => {
  const other = alternatives?.durations[0];
  const next = Option.getOrUndefined(alternatives?.nextDate ?? Option.none());
  const sentences = [
    ...(other === undefined
      ? []
      : [
          m.booking_meeting_room_other_length_free(
            { length: lengthLabel(other) },
            { locale }
          ),
        ]),
    ...(next === undefined
      ? []
      : [
          m.booking_meeting_room_next_free_day(
            { length, date: shortDate(next) },
            { locale }
          ),
        ]),
  ];
  return sentences.length > 0
    ? sentences.join(" ")
    : m.booking_meeting_room_pick_another_day({}, { locale });
};

/**
 * Why checkout sent the customer back, read inside the step's scroll view,
 * so a restart scrolls it back to the top where this notice says why.
 */
function MeetingRoomRestartNotice({
  onReread,
}: {
  readonly onReread: () => void;
}) {
  return <RestartNotice reason={useRestartReason(onReread)} />;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  after: { marginTop: space.md },
  loading: { alignItems: "center", paddingVertical: space.xl },
  // The row's own gutter would inset the box; the board puts it on the
  // screen's.
  earlySetup: { marginHorizontal: -space.lg, marginTop: space.xl },
  // Under the label: the row's gutter, the 22 box and the 14 between.
  earlySetupReason: {
    color: color.ink2,
    paddingLeft: space.lg + 22 + 14,
    paddingRight: space.lg,
  },
});
