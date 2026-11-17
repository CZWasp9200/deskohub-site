import type {
  CustomerBookedSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { type Array as Arr, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useRouter } from "expo-router";
import Coffee from "lucide-react-native/icons/coffee";
import Monitor from "lucide-react-native/icons/monitor";
import Moon from "lucide-react-native/icons/moon";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Sun from "lucide-react-native/icons/sun";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { Notice } from "../../ui/notice";
import { SegmentedChoice } from "../../ui/segmented-choice";
import { Skeleton, SkeletonGroup } from "../../ui/skeleton";
import { color, radius, space } from "../../ui/tokens";
import { bookingPreselectionKey } from "../booking-preselection";
import { bookCheckoutHref } from "../booking-routes";
import { checkoutRequestAtom } from "../checkout/checkout-flow";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
} from "../data/booking-queries";
import {
  type CoworkBlocker,
  type CoworkDraft,
  type CoworkOffering,
  coworkAvailabilityQueries,
  coworkBookableDates,
  coworkDayQuery,
  freeCoworkTierOn,
  offeredCoworkTiers,
  selectCoworkDate,
  selectCoworkStay,
  selectCoworkTier,
  selectCoworkWorkstation,
} from "../selection/cowork-selection";
import type { PragueDate } from "../selection/prague-date";
import { pragueToday } from "../selection/prague-date";
import { AddonOptions, AddonToggle } from "../ui/addon-toggle";
import { BookingBar } from "../ui/booking-bar";
import { BookingSectionHeading } from "../ui/booking-section-heading";
import { BookingStepLayout } from "../ui/booking-step-layout";
import { MonthCalendar } from "../ui/month-calendar";
import { formatShortPragueDate } from "../ui/prague-date-format";
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
import {
  coworkBookingModel,
  type KeptCoworkDraft,
  openingCoworkDraft,
} from "./cowork-booking-model";
import {
  type CoworkTierCard,
  CoworkTierCards,
  tierArtwork,
} from "./cowork-tier-cards";
import { RestartNotice } from "./restart-notice";
import { selectionBar } from "./selection-bar";

/**
 * The customer's cowork draft, with the preselection it grew from; none
 * until they change what the screen opened with.
 */
const coworkDraftAtom = Atom.make(Option.none<KeptCoworkDraft>());

const blockerMessage = (blocker: CoworkBlocker, locale: AppLocale) =>
  ({
    DateRequired: () => m.booking_choose_date_reason({}, { locale }),
    AvailabilityPending: () => undefined,
    DateOutOfRange: () => m.booking_error_date_out_of_range({}, { locale }),
    OpenSpaceClosedToday: () =>
      m.booking_cowork_open_space_closed_today({}, { locale }),
    OfferUnavailable: () => m.booking_cowork_offer_unavailable({}, { locale }),
    WorkstationUnavailable: () =>
      m.booking_cowork_workstation_unavailable({}, { locale }),
    WorkstationRequired: () =>
      m.booking_cowork_workstation_required({}, { locale }),
  })[blocker._tag]();

/**
 * Cowork: an Open Space or Reserved Desk day with its extras, opened empty
 * or on a booked selection ("Book again").
 */
export function CoworkBookingScreen() {
  useBookingStarted("cowork");
  const preselection = useBookingPreselection("cowork");
  return (
    <View style={styles.screen}>
      <BookingGate>
        <CoworkCatalog preselection={preselection} />
      </BookingGate>
    </View>
  );
}

function CoworkCatalog({
  preselection,
}: {
  readonly preselection: Option.Option<CustomerBookedSelection>;
}) {
  const locale = useAppLocale();
  const catalogAtom = bookingOfferingsAtom(locale);
  const read = bookingReadOf(useAtomValue(catalogAtom));
  const refresh = useAtomRefresh(catalogAtom);
  const catalog = readValue(read);
  const tiers = Option.flatMap(catalog, ({ offerings }) =>
    offeredCoworkTiers(offerings)
  );
  if (Option.isSome(catalog) && Option.isSome(tiers)) {
    return (
      <CoworkSelection
        offerings={catalog.value.offerings}
        tiers={tiers.value}
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
            title: m.booking_family_cowork_title({}, { locale }),
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
      <BookingReadView
        read={read}
        onRetry={refresh}
        loading={<CoworkSkeleton locale={locale} />}
      >
        {() => null}
      </BookingReadView>
    </BookingStepLayout>
  );
}

function CoworkSelection({
  offerings,
  tiers,
  catalog,
  onRetryCatalog,
  preselection,
}: {
  readonly offerings: ReadonlyArray<CustomerOffering>;
  /** The cowork offerings, one per tier; never empty. */
  readonly tiers: Arr.NonEmptyReadonlyArray<CoworkOffering>;
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
  const [kept, setStored] = useAtom(coworkDraftAtom);
  const draft = openingCoworkDraft({ kept, preselection, offerings });
  const setDraft = (next: CoworkDraft) =>
    setStored(Option.some({ seed, draft: next }));

  const bookableDates = coworkBookableDates(tiers, draft.tier);
  const queries = coworkAvailabilityQueries(draft, bookableDates);
  const rangeAtom = bookingAvailabilityAtom({ query: queries.range });
  const selectionAtom = Option.match(queries.selection, {
    onNone: () => unneededReadAtom,
    onSome: (query) => bookingAvailabilityAtom({ query }),
  });
  const requirementAtom = Option.match(queries.workstationRequirement, {
    onNone: () => unneededReadAtom,
    onSome: (query) => bookingAvailabilityAtom({ query }),
  });
  const range = bookingReadOf(useAtomValue(rangeAtom));
  const selected = bookingReadOf(useAtomValue(selectionAtom));
  const requirement = bookingReadOf(useAtomValue(requirementAtom));
  const refreshRange = useAtomRefresh(rangeAtom);
  const refreshSelected = useAtomRefresh(selectionAtom);
  const refreshRequirement = useAtomRefresh(requirementAtom);

  const model = coworkBookingModel({
    draft,
    now,
    offerings,
    bookableDates,
    availability: {
      range: readValue(range),
      selection: Option.flatMap(queries.selection, () => loadedValue(selected)),
      workstationRequirement: Option.flatMap(
        queries.workstationRequirement,
        () => loadedValue(requirement)
      ),
    },
  });
  const { enablement } = model;

  // Keep the workstation the availability fitted, so the next reads are for it.
  useEffect(() => {
    if (model.draft !== draft) {
      setStored(Option.some({ seed, draft: model.draft }));
    }
  }, [model.draft, draft, seed, setStored]);

  const quoteAtom = Option.match(model.quotable, {
    onNone: () => unneededReadAtom,
    onSome: (selection) => bookingQuoteAtom(selection, locale),
  });
  const quoteResult = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const quote = Option.map(model.quotable, () => bookingReadOf(quoteResult));

  // A full day the customer tapped, explained for the tier it is full for.
  const [tapped, setTapped] = useState<{
    readonly date: PragueDate;
    readonly tier: CoworkDraft["tier"];
  }>();
  const focusedDay = tapped?.tier === draft.tier ? tapped.date : undefined;
  const dayAtom =
    focusedDay === undefined
      ? unneededReadAtom
      : bookingAvailabilityAtom({
          query: coworkDayQuery(draft)(focusedDay),
        });
  const day = loadedValue(bookingReadOf(useAtomValue(dayAtom)));

  const rereadAvailability = () => {
    refreshRange();
    refreshSelected();
    refreshRequirement();
  };
  const supportingReads = [range, selected, requirement];
  const quoteRepeats = quoteFailureRepeats(quote, supportingReads, (error) =>
    bookingQueryMessage(error, locale)
  );
  const retrySupportingReads = () => {
    rereadAvailability();
    if (quoteRepeats) refreshQuote();
  };

  const chosen = tiers.find(({ tier }) => tier === model.draft.tier);
  const chosenDate = Option.getOrUndefined(model.draft.date);
  const shortDate = (date: PragueDate) => formatShortPragueDate(date, locale);
  const blocked = enablement.blockers.flatMap((blocker) => {
    const message = blockerMessage(blocker, locale);
    return message === undefined ? [] : [message];
  });
  const overnightStay = Option.getOrUndefined(model.overnightStay);
  // The stay's times, for summaries of an overnight selection.
  const overnightTimes =
    overnightStay !== undefined && model.draft.stay === "overnight"
      ? { overnightStay }
      : {};
  const checkout = checkoutRequestOf({
    locale,
    selection: model.selection,
    blockers: enablement.blockers,
    quote: Option.flatMap(quote, freshValue),
    ...overnightTimes,
  });
  const failedQuote = Option.getOrUndefined(quote);
  const quoteFailure =
    failedQuote?.kind === "failed" && !quoteRepeats ? failedQuote : undefined;

  const bar =
    chosen === undefined
      ? undefined
      : selectionBar({
          from: {
            title: chosen.name,
            amount: chosen.advertisedPrice.price,
            unit:
              model.draft.stay === "overnight"
                ? m.booking_price_unit_per_night({}, { locale })
                : m.booking_price_unit_per_day({}, { locale }),
            ...overnightTimes,
          },
          selection: model.selection,
          quote,
          blocked: Option.fromNullishOr(blocked[0]),
          canContinue: Option.isSome(checkout),
          locale,
        });

  const cards = tiers.map(
    (offering): CoworkTierCard => ({
      tier: offering.tier,
      name: offering.name,
      price: offering.advertisedPrice.price,
      ...(offering.advertisedPrice.discount.value > 0 && {
        was: offering.price,
      }),
      description: offering.summary ?? offering.usage,
      artwork: tierArtwork(
        offering.tier,
        offering.tier === model.draft.tier &&
          Option.isSome(model.draft.workstation)
      ),
      ...(chosenDate !== undefined &&
        enablement.unavailableTiers.has(offering.tier) && {
          unavailable: m.booking_cowork_tier_full(
            { date: shortDate(chosenDate) },
            { locale }
          ),
        }),
    })
  );

  const fullDayInfo =
    focusedDay === undefined || chosen === undefined
      ? undefined
      : Option.match(day, {
          onNone: () =>
            m.booking_cowork_day_full(
              { date: shortDate(focusedDay), tier: chosen.name },
              { locale }
            ),
          onSome: (availability) =>
            Option.match(
              freeCoworkTierOn(availability, offerings, chosen.tier),
              {
                onNone: () =>
                  m.booking_cowork_day_full_pick_another(
                    { date: shortDate(focusedDay), tier: chosen.name },
                    { locale }
                  ),
                onSome: (other) =>
                  m.booking_cowork_day_full_other_free(
                    {
                      date: shortDate(focusedDay),
                      tier: chosen.name,
                      other: other.name,
                    },
                    { locale }
                  ),
              }
            ),
        });

  const coffee =
    model.draft.tier === "open-space"
      ? chosen?.addOns.find(({ id, included }) => id === "coffee" && !included)
      : undefined;
  const workstation =
    model.draft.tier === "reserved-desk" && enablement.workstations.length > 0
      ? chosen?.addOns.find(({ id }) => id === "workstation")
      : undefined;
  const chosenWorkstation = Option.getOrUndefined(model.draft.workstation);
  const firstFreeWorkstation = enablement.workstations.find(
    ({ id }) => !enablement.unavailableWorkstations.has(id)
  );

  return (
    <BookingStepLayout
      step="choose"
      locale={locale}
      bar={
        bar && (
          <BookingBar
            locale={locale}
            summary={bar.summary}
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
        )
      }
    >
      <BookingReadView read={catalog} onRetry={onRetryCatalog}>
        {() => (
          <>
            <CoworkRestartNotice
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

            <BookingSectionHeading
              title={m.booking_cowork_tier_heading({}, { locale })}
              first
            />
            <CoworkTierCards
              label={m.booking_cowork_tier_heading({}, { locale })}
              cards={cards}
              selected={model.draft.tier}
              onSelect={(tier) => {
                setTapped(undefined);
                setDraft(selectCoworkTier(model.draft, tier));
              }}
              locale={locale}
            />
            {overnightStay !== undefined && (
              <>
                <BookingSectionHeading
                  title={m.booking_cowork_stay_label({}, { locale })}
                />
                <SegmentedChoice
                  label={m.booking_cowork_stay_label({}, { locale })}
                  options={[
                    {
                      value: "day",
                      icon: Sun,
                      label: m.booking_cowork_stay_day({}, { locale }),
                    },
                    {
                      value: "overnight",
                      icon: Moon,
                      label: m.booking_cowork_stay_overnight({}, { locale }),
                    },
                  ]}
                  selected={model.draft.stay}
                  onSelect={(stay) => {
                    setTapped(undefined);
                    setDraft(selectCoworkStay(model.draft, stay));
                  }}
                />
              </>
            )}

            <BookingSectionHeading
              title={m.booking_date_heading({}, { locale })}
            />
            <MonthCalendar
              label={m.booking_date_heading({}, { locale })}
              locale={locale}
              dates={enablement.dates}
              selected={chosenDate}
              onSelect={(date) => {
                setTapped(undefined);
                setDraft(selectCoworkDate(model.draft, date));
              }}
              today={today}
              focusedDate={focusedDay}
              onUnavailablePress={(date) =>
                setTapped({ date, tier: model.draft.tier })
              }
              dayInfo={fullDayInfo}
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
                    .map((notice) => availabilityNoticeMessage(notice, locale))
                    .join(" ") || undefined
                }
              />
            </View>

            {coffee !== undefined && (
              <>
                <BookingSectionHeading title={coffee.name} />
                <AddonToggle
                  label={coffee.name}
                  icon={Coffee}
                  checked={model.draft.coffee}
                  onToggle={(checked) =>
                    setDraft({ ...model.draft, coffee: checked })
                  }
                  price={m.booking_addon_price(
                    { price: formatMoney(coffee.price, locale) },
                    { locale }
                  )}
                />
              </>
            )}

            {workstation !== undefined && (
              <>
                <BookingSectionHeading title={workstation.name} />
                <AddonToggle
                  label={workstation.name}
                  icon={Monitor}
                  checked={chosenWorkstation !== undefined}
                  disabled={enablement.workstationRequired}
                  onToggle={(checked) =>
                    setDraft(
                      selectCoworkWorkstation(
                        model.draft,
                        checked
                          ? Option.fromNullishOr(firstFreeWorkstation?.id)
                          : Option.none()
                      )
                    )
                  }
                  price={m.booking_addon_price(
                    { price: formatMoney(workstation.price, locale) },
                    { locale }
                  )}
                />
                {chosenWorkstation !== undefined && (
                  <AddonOptions
                    label={workstation.name}
                    options={enablement.workstations.map(({ id, name }) => ({
                      value: id,
                      label: name,
                      disabled: enablement.unavailableWorkstations.has(id),
                    }))}
                    selected={chosenWorkstation.option}
                    onSelect={(option) =>
                      setDraft(
                        selectCoworkWorkstation(
                          model.draft,
                          Option.some(option)
                        )
                      )
                    }
                  />
                )}
                <View style={styles.after}>
                  <Notice
                    tone="info"
                    message={
                      chosenWorkstation?.origin === "requirement"
                        ? m.booking_cowork_workstation_added({}, { locale })
                        : undefined
                    }
                  />
                </View>
              </>
            )}
          </>
        )}
      </BookingReadView>
    </BookingStepLayout>
  );
}

/**
 * Why checkout sent the customer back, read inside the step's scroll view,
 * so a restart scrolls it back to the top where this notice says why.
 */
function CoworkRestartNotice({ onReread }: { readonly onReread: () => void }) {
  return <RestartNotice reason={useRestartReason(onReread)} />;
}

/** The first load: the tiers and the calendar in their final layout. */
export function CoworkSkeleton({ locale }: { readonly locale: AppLocale }) {
  return (
    <SkeletonGroup label={m.account_loading({}, { locale })}>
      <BookingSectionHeading
        title={m.booking_cowork_tier_heading({}, { locale })}
        first
      />
      <View style={styles.skeletonTiers}>
        {(["first", "second"] as const).map((key) => (
          <View key={key} style={[styles.skeletonCard, styles.skeletonTier]}>
            <Skeleton width={20} height={20} radius={10} />
            <View style={styles.skeletonText}>
              <Skeleton width="50%" height={14} />
              <Skeleton width="30%" height={12} />
              <Skeleton width="90%" height={10} />
            </View>
            <Skeleton width={72} height={56} radius={radius.tile} />
          </View>
        ))}
      </View>
      <BookingSectionHeading title={m.booking_date_heading({}, { locale })} />
      <View style={styles.skeletonCard}>
        <View style={styles.skeletonMonth}>
          <Skeleton width="40%" height={14} />
        </View>
        {(["a", "b", "c", "d"] as const).map((week) => (
          <View key={week} style={styles.skeletonWeek}>
            {(["1", "2", "3", "4", "5", "6", "7"] as const).map((dayKey) => (
              <View key={dayKey} style={styles.skeletonDay}>
                <Skeleton width="100%" height={28} radius={14} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  after: { marginTop: space.sm },
  skeletonTiers: { gap: space.sm },
  skeletonCard: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    padding: space.lg,
  },
  skeletonTier: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.md,
  },
  skeletonText: { flex: 1, gap: space.sm },
  skeletonMonth: {
    alignItems: "center",
    marginBottom: 18,
    marginTop: space.xs,
  },
  skeletonWeek: { flexDirection: "row", gap: 10, marginBottom: 14 },
  skeletonDay: { flex: 1 },
});
