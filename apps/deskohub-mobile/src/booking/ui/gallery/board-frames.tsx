import { RegistryProvider } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/reactivity";
import Coffee from "lucide-react-native/icons/coffee";
import Monitor from "lucide-react-native/icons/monitor";
import Moon from "lucide-react-native/icons/moon";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { customerDataLayer } from "../../../customer-api/customer-data-runtime";
import type { AppLocale } from "../../../i18n/app-locale";
import { homeCountry } from "../../../i18n/country-names";
import { useAppLocale } from "../../../i18n/locale-context";
import { m } from "../../../i18n/messages";
import { AppBar } from "../../../ui/app-bar";
import { CheckboxRow } from "../../../ui/checkbox";
import { FocusedStatusBar } from "../../../ui/focused-status-bar";
import { useSample } from "../../../ui/gallery/gallery-kit";
import { Notice } from "../../../ui/notice";
import { Switch } from "../../../ui/switch";
import { color, radius, space } from "../../../ui/tokens";
import {
  type DetailsDraft,
  type DetailsProfile,
  initialDetailsDraft,
} from "../../checkout-screen/details-form";
import { DetailsStep } from "../../checkout-screen/details-step";
import {
  CoworkBookingScreen,
  CoworkSkeleton,
} from "../../family/cowork-booking-screen";
import {
  type CoworkTierCard,
  CoworkTierCards,
  tierArtwork,
} from "../../family/cowork-tier-cards";
import { MeetingRoomBookingScreen } from "../../family/meeting-room-booking-screen";
import { MeetingRoomHero } from "../../family/meeting-room-hero";
import {
  type MeetingRoomLength,
  MeetingRoomLengths,
} from "../../family/meeting-room-lengths";
import { MeetingRoomNoneLeft } from "../../family/meeting-room-none-left";
import { MeetingRoomStartTimes } from "../../family/meeting-room-start-times";
import {
  OfficeBookingScreen,
  OfficeStayControls,
} from "../../family/office-booking-screen";
import { RestartNotice } from "../../family/restart-notice";
import type { DateChoice } from "../../selection/booking-selection";
import type { PragueDate } from "../../selection/prague-date";
import { czk } from "../../testing/sample-booking-catalog";
import { AddonOptions, AddonToggle } from "../addon-toggle";
import { BookingBar, type BookingBarAction } from "../booking-bar";
import { BookingSectionHeading } from "../booking-section-heading";
import { type BookingStep, BookingSteps } from "../booking-steps";
import { type HoldStatus, HoldStatusChip } from "../hold-timer";
import { MonthCalendar } from "../month-calendar";
import { OvernightStayTimes } from "../overnight-stay-times";
import {
  meetingRoomHour,
  officeSixSeats,
  openSpaceWithCoffee,
  reservedDeskWithWorkstation,
} from "../testing/price-fixtures";
import { bookTabFrames } from "./book-tab-frames";
import {
  coworkDates,
  officeDates,
  officeRange,
  quotedPrice as quoted,
  galleryToday as today,
} from "./gallery-fixtures";
import { reviewFrames } from "./review-frames";

/**
 * The booking boards' proposed frames (boards 26–35) rebuilt from the shared
 * booking pieces, one full screen each, for device captures next to the
 * boards: app bar with the hold chip, step progress, a body with the real
 * calendar and price card, and the booking bar pinned at the bottom. Screen
 * content that the screen tickets build (desk cards, forms, consent) is a
 * labelled placeholder. All data is synthetic, seen on Tue 10 Nov 2026 as the
 * boards draw it.
 */
export interface BoardFrame {
  /** URL key: `deskohub://dev/booking-components?frame=<key>`. */
  readonly key: string;
  /** The board the proposed frame is on, such as "26b". */
  readonly board: string;
  /** The proposed frame's caption on that board. */
  readonly state: string;
  readonly Screen: (props: { readonly onBack: () => void }) => ReactNode;
}

const chosenDay: PragueDate = "2026-11-26";
const fullDay: PragueDate = "2026-11-20";

const ignore = () => undefined;

// ------------------------------------------------------------ screen shell

/**
 * A booking step as the boards draw it: status bar, app bar (with the hold
 * chip on the review), step progress, an optional pinned banner, the body,
 * and the bar pinned at the bottom. `at="end"` shows the body scrolled to
 * its end, as the boards' "end" frames do; a frame scrolled away from the
 * top raises the steps.
 */
function FlowScreen({
  title,
  step,
  locale,
  onBack,
  bar,
  hold: holdStatus,
  banner,
  at = "top",
  raised = at === "end",
  overlay,
  children,
}: {
  readonly title: string;
  readonly step: BookingStep;
  readonly locale: AppLocale;
  readonly onBack: () => void;
  readonly bar: ReactNode;
  readonly hold?: HoldStatus;
  readonly banner?: ReactNode;
  readonly at?: "top" | "end";
  readonly raised?: boolean;
  readonly overlay?: ReactNode;
  readonly children: ReactNode;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const toEnd = () => {
    if (at === "end") scroll.current?.scrollToEnd({ animated: false });
  };
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FocusedStatusBar style="dark" />
      <AppBar
        title={title}
        onBack={onBack}
        actions={
          holdStatus && <HoldStatusChip status={holdStatus} locale={locale} />
        }
      />
      <BookingSteps current={step} raised={raised} locale={locale} />
      {banner && <View style={styles.banner}>{banner}</View>}
      <ScrollView
        ref={scroll}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        // Content and viewport both change (the breakdown opening shrinks
        // the viewport), so an end frame is put back at its end on either.
        onContentSizeChange={toEnd}
        onLayout={toEnd}
      >
        {children}
      </ScrollView>
      {bar}
      {overlay}
    </SafeAreaView>
  );
}

function Calendar({
  locale,
  ...props
}: Partial<Parameters<typeof MonthCalendar>[0]> & {
  readonly locale: AppLocale;
}) {
  const czech = locale === "cs-CZ";
  return (
    <MonthCalendar
      label={czech ? "Datum" : "Date"}
      locale={locale}
      dates={coworkDates}
      selected={undefined}
      onSelect={ignore}
      previousMonthLabel={czech ? "Předchozí měsíc" : "Previous month"}
      nextMonthLabel={czech ? "Další měsíc" : "Next month"}
      unavailableLabel={czech ? "nedostupné" : "not available"}
      today={today}
      {...props}
    />
  );
}

/** Board 26's desk cards, the chosen one first-class. */
function DeskCards({
  locale,
  selected = "open-space",
  workstation = false,
  only,
}: {
  readonly locale: AppLocale;
  readonly selected?: CoworkTierCard["tier"];
  readonly workstation?: boolean;
  readonly only?: CoworkTierCard["tier"];
}) {
  const sample = useSample();
  const czech = locale === "cs-CZ";
  const cards: ReadonlyArray<CoworkTierCard> = [
    {
      tier: "open-space",
      name: sample(czech ? "Sdílené místo" : "Open Space"),
      price: czk(232),
      was: czk(290),
      description: sample(
        czech
          ? "Seď, kde chceš, k dispozici do 17:00."
          : "Sit wherever you like, available until 17:00."
      ),
      artwork: tierArtwork("open-space", false),
    },
    {
      tier: "reserved-desk",
      name: sample(czech ? "Vyhrazené místo" : "Reserved Desk"),
      price: czk(328),
      was: czk(410),
      description: sample(
        czech
          ? "Tvůj vlastní stůl pro nepřetržitý flow."
          : "Your own desk for uninterrupted flow."
      ),
      artwork: tierArtwork("reserved-desk", workstation),
    },
  ];
  return (
    <CoworkTierCards
      label={sample("Desk type")}
      cards={cards.filter((card) => only === undefined || card.tier === only)}
      selected={selected}
      onSelect={ignore}
      locale={locale}
    />
  );
}

const next = (
  label: string,
  overrides: Partial<BookingBarAction> = {}
): BookingBarAction => ({ label, onPress: ignore, ...overrides });

// ------------------------------------------------------------ boards 26–27: cowork desk

function CoworkStart({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Open Space desk"),
            price: { kind: "from", amount: czk(232), unit: sample("per day") },
          }}
          action={next(sample("Continue"), { disabled: true })}
          reason={sample("Choose a date to continue")}
        />
      }
    >
      <BookingSectionHeading title={sample("Desk type")} first />
      <DeskCards locale={locale} />
      <BookingSectionHeading title={sample("Date")} />
      <Calendar locale={locale} />
    </FlowScreen>
  );
}

function CoworkChosen({
  onBack,
  opened = false,
}: {
  readonly onBack: () => void;
  readonly opened?: boolean;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      at="end"
      bar={
        <BookingBar
          locale={locale}
          initiallyOpen={opened}
          summary={{
            title: sample("Thu 26 Nov, until 17:00"),
            detail: sample("Open Space desk · coffee"),
            price: quoted(openSpaceWithCoffee, locale, czk(340)),
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <BookingSectionHeading title={sample("Desk type")} first />
      <DeskCards locale={locale} />
      <BookingSectionHeading title={sample("Date")} />
      <Calendar locale={locale} selected={chosenDay} />
      <BookingSectionHeading title={sample("Coffee")} />
      <AddonToggle
        label={sample("Coffee")}
        icon={Coffee}
        checked
        onToggle={ignore}
        price="+ CZK 50"
      />
    </FlowScreen>
  );
}

/** Reserved Desk with the overnight stay offered; the switch toggles it. */
function CoworkOvernight({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  const [overnight, setOvernight] = useState(true);
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      at="end"
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample(
              overnight
                ? "Thu 26 Nov 12:00 → Fri 27 Nov 12:00"
                : "Thu 26 Nov, 08:00–18:00"
            ),
            detail: sample("Reserved Desk"),
            price: {
              kind: "from",
              amount: czk(328),
              unit: sample(overnight ? "per night" : "per day"),
            },
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <BookingSectionHeading title={sample("Desk type")} first />
      <DeskCards locale={locale} selected="reserved-desk" />
      <BookingSectionHeading
        title={sample("Date")}
        control={
          <Switch
            label={sample("Overnight")}
            accessibilityLabel={sample("Overnight")}
            icon={Moon}
            value={overnight}
            onValueChange={setOvernight}
          />
        }
      />
      <Calendar locale={locale} selected={chosenDay} />
      {overnight && (
        <OvernightStayTimes
          times={sample("Thu 26 Nov 12:00 → Fri 27 Nov 12:00")}
        />
      )}
    </FlowScreen>
  );
}

function CoworkFullDay({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      raised
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Open Space desk"),
            price: { kind: "from", amount: czk(232), unit: sample("per day") },
          }}
          action={next(sample("Continue"), { disabled: true })}
          reason={sample("Choose a date to continue")}
        />
      }
    >
      <BookingSectionHeading title={sample("Date")} first />
      <Calendar
        locale={locale}
        focusedDate={fullDay}
        onUnavailablePress={ignore}
        dayInfo={sample(
          "Fri 20 Nov is full for Open Space. A reserved desk is still free that day, or pick another date."
        )}
        legend={false}
      />
    </FlowScreen>
  );
}

function ReservedDeskOpened({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      raised
      bar={
        <BookingBar
          locale={locale}
          initiallyOpen
          summary={{
            title: sample("Thu 26 Nov, 24/7"),
            detail: sample("Reserved desk · 2× 27″ QHD"),
            price: quoted(reservedDeskWithWorkstation, locale),
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <DeskCards
        locale={locale}
        selected="reserved-desk"
        workstation
        only="reserved-desk"
      />
      <BookingSectionHeading title={sample("Date")} />
      <Calendar locale={locale} selected={chosenDay} legend={false} />
      <BookingSectionHeading title={sample("Monitor workstation")} />
      <AddonToggle
        label={sample("Monitor workstation")}
        icon={Monitor}
        checked
        onToggle={ignore}
        price="+ CZK 120"
      />
      <AddonOptions
        label={sample("Monitor workstation")}
        options={[
          { value: "2x27-qhd", label: "2× 27″ QHD" },
          { value: "2x32-qhd", label: "2× 32″ QHD" },
          { value: "2x27-4k", label: "2× 27″ 4K" },
          { value: "2x32-4k", label: "2× 32″ 4K" },
        ]}
        selected="2x27-qhd"
        onSelect={ignore}
      />
    </FlowScreen>
  );
}

function CoworkLoading({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{ title: sample("Cowork desk"), price: { kind: "none" } }}
          action={next(sample("Continue"), { disabled: true })}
        />
      }
    >
      <CoworkSkeleton locale={locale} />
    </FlowScreen>
  );
}

function CoworkPriceError({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Thu 26 Nov, until 17:00"),
            detail: sample("Open Space desk · coffee"),
            price: { kind: "none" },
          }}
          action={next(sample("Try again"), { icon: RotateCcw })}
        />
      }
    >
      <Notice
        tone="error"
        title={sample("Price not available")}
        message={sample("We couldn’t get the price for Thu 26 Nov.")}
      />
      <BookingSectionHeading title={sample("Date")} />
      <Calendar locale={locale} selected={chosenDay} legend={false} />
    </FlowScreen>
  );
}

/**
 * The real cowork screen over the sample Workspace, without signing in, so a
 * capture reaches its live states. The gallery's route params reach it: a
 * booked selection (`&tier=reserved-desk&date=…`) or `&restart=hold_expired`.
 */
function CoworkLive({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  // Metro drops the branch from release bundles, so the fake Workspace and
  // its fixtures never ship there (see `customer-data-provider.tsx`); read
  // at render, as Bun's tests don't define `__DEV__`.
  const [initialValues] = useState(() =>
    __DEV__
      ? [
          Atom.initialValue(
            customerDataLayer,
            (
              require("../../../customer-api/testing/sample-data-layer") as typeof import("../../../customer-api/testing/sample-data-layer")
            ).sampleCustomerDataLayer("linked")
          ),
        ]
      : []
  );
  return (
    <RegistryProvider initialValues={initialValues}>
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <FocusedStatusBar style="dark" />
        <AppBar
          title={m.booking_family_cowork_title({}, { locale })}
          onBack={onBack}
        />
        <CoworkBookingScreen />
      </SafeAreaView>
    </RegistryProvider>
  );
}

/** Board 27: back after the hold ran out, the choices kept. */
function CoworkRestart({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Cowork desk")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Thu 26 Nov, until 17:00"),
            detail: sample("Open Space desk · coffee"),
            price: quoted(openSpaceWithCoffee, locale, czk(340)),
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <RestartNotice reason={Option.some("hold_expired")} />
      <BookingSectionHeading title={sample("Desk type")} />
      <DeskCards locale={locale} />
      <BookingSectionHeading title={sample("Date")} />
      <Calendar locale={locale} selected={chosenDay} legend={false} />
    </FlowScreen>
  );
}

/** Board 27's Czech strings at their real length; the whole frame in cs-CZ. */
function CoworkCzech({ onBack }: { readonly onBack: () => void }) {
  const locale: AppLocale = "cs-CZ";
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Místo v coworku")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Čtvrtek 26. listopadu, do 17:00"),
            detail: sample("Místo v Open Space · káva"),
            price: quoted(openSpaceWithCoffee, locale, czk(340)),
          }}
          action={next(sample("Pokračovat"))}
        />
      }
    >
      <BookingSectionHeading title={sample("Datum")} first />
      <Calendar locale={locale} selected={chosenDay} legend={false} />
      <BookingSectionHeading title={sample("Káva")} />
      <AddonToggle
        label={sample("Káva")}
        icon={Coffee}
        checked
        onToggle={ignore}
        price="+ 50 Kč"
      />
    </FlowScreen>
  );
}

// ------------------------------------------------------------ board 28: meeting room

/** Board 28's start times: 08:00–19:00, four taken; the rest behind the link. */
const meetingRoomStarts = (() => {
  const taken = new Set(["09:00", "10:00", "16:00", "18:00"]);
  const daytime = Array.from({ length: 12 }, (_, offset) => {
    const startTime = `${String(8 + offset).padStart(2, "0")}:00`;
    return {
      startTime,
      taken: taken.has(startTime),
      earlySetupAvailable: !taken.has(startTime),
    };
  });
  const outside = ["07:00", "20:00", "21:00"].map((startTime) => ({
    startTime,
    taken: false,
    earlySetupAvailable: true,
  }));
  return { daytime, outside };
})();

const meetingRoomDates: DateChoice = {
  earliest: today,
  latest: "2027-05-10",
  unavailable: new Set(["2026-11-13"]),
};

function MeetingRoomLengthList({
  selected,
}: {
  readonly selected: MeetingRoomLength["duration"];
}) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <MeetingRoomLengths
      label={sample("How long?")}
      lengths={[
        {
          duration: "hour:1",
          label: sample("1 hour"),
          price: czk(280),
          was: czk(350),
        },
        {
          duration: "hour:4",
          label: sample("4 hours"),
          price: czk(784),
          was: czk(980),
        },
        {
          duration: "day:1",
          label: sample("Whole day"),
          price: czk(1456),
          was: czk(1820),
        },
      ]}
      selected={selected}
      onSelect={ignore}
      locale={locale}
    />
  );
}

/** Board 28 "Start": the illustration and the room's facts, then the date. */
function MeetingRoomStart({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Meeting room")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Meeting room"),
            price: {
              kind: "from",
              amount: czk(280),
              unit: sample("per hour"),
            },
          }}
          action={next(sample("Continue"), { disabled: true })}
          reason={sample("Choose a date, then a length and a start time")}
        />
      }
    >
      <MeetingRoomHero
        facts={[
          { kind: "capacity", text: sample("Up to 10 people") },
          { kind: "equipment", text: sample("TV and projector") },
        ]}
      />
      <BookingSectionHeading title={sample("Date")} />
      <Calendar locale={locale} dates={meetingRoomDates} today={today} />
    </FlowScreen>
  );
}

/**
 * Board 28 "Length and start time" and "Early setup" (`early`, scrolled to
 * the end), and 28b "Price opened" (`opened`).
 */
function MeetingRoom({
  onBack,
  early = false,
  opened = false,
}: {
  readonly onBack: () => void;
  readonly early?: boolean;
  readonly opened?: boolean;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Meeting room")}
      step="choose"
      locale={locale}
      onBack={onBack}
      at={early || opened ? "end" : "top"}
      bar={
        <BookingBar
          locale={locale}
          initiallyOpen={opened}
          summary={{
            title: sample("Wed 18 Nov, 14:00–15:00"),
            detail: sample(
              early || opened
                ? "Meeting room · in from 13:45"
                : "Meeting room · 1 hour"
            ),
            price: quoted(meetingRoomHour, locale, czk(350)),
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <BookingSectionHeading
        title={sample("How long?")}
        aside={sample("Wed 18 Nov")}
        first
      />
      <MeetingRoomLengthList selected="hour:1" />
      <BookingSectionHeading title={sample("Start time")} />
      <MeetingRoomStartTimes
        label={sample("Start time")}
        daytime={meetingRoomStarts.daytime}
        outside={meetingRoomStarts.outside}
        selected="14:00"
        onSelect={ignore}
        locale={locale}
      />
      {(early || opened) && (
        <View style={styles.earlySetup}>
          <CheckboxRow
            label={sample("I want to come 15 minutes early")}
            checked
            onChange={ignore}
          />
        </View>
      )}
    </FlowScreen>
  );
}

/** Board 28b "Whole day": no start times when they don't apply. */
function MeetingRoomWholeDay({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Meeting room")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Wed 18 Nov, whole day"),
            detail: sample("Meeting room"),
            price: { kind: "from", amount: czk(1456), was: czk(1820) },
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <BookingSectionHeading
        title={sample("How long?")}
        aside={sample("Wed 18 Nov")}
        first
      />
      <MeetingRoomLengthList selected="day:1" />
    </FlowScreen>
  );
}

/** Board 28b "Nothing left for that length": what is still free instead. */
function MeetingRoomNoneLeftFrame({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Meeting room")}
      step="choose"
      locale={locale}
      onBack={onBack}
      bar={
        <BookingBar
          locale={locale}
          summary={{
            title: sample("Thu 12 Nov"),
            detail: sample("Meeting room · 4 hours"),
            price: { kind: "from", amount: czk(784) },
          }}
          action={next(sample("Continue"), { disabled: true })}
          reason={sample("Choose a start time to continue")}
        />
      }
    >
      <BookingSectionHeading
        title={sample("How long?")}
        aside={sample("Thu 12 Nov")}
        first
      />
      <MeetingRoomLengthList selected="hour:4" />
      <BookingSectionHeading title={sample("Start time")} />
      <MeetingRoomNoneLeft
        title={sample("Nothing free for 4 hours on Thu 12 Nov")}
        body={sample(
          "1 hour is still free that day. The next free day for 4 hours is Sat 14 Nov."
        )}
        actions={[
          { label: sample("Switch to 1 hour"), onPress: ignore },
          { label: sample("Go to Sat 14 Nov"), onPress: ignore },
        ]}
      />
    </FlowScreen>
  );
}

/**
 * The real meeting-room screen over the sample Workspace, without signing
 * in, so a capture reaches its live states. The gallery's route params
 * reach it: a booked selection (`&date=…&duration=hour:1&startTime=14:00`)
 * or `&restart=hold_expired`.
 */
function MeetingRoomLive({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const [initialValues] = useState(() =>
    __DEV__
      ? [
          Atom.initialValue(
            customerDataLayer,
            (
              require("../../../customer-api/testing/sample-data-layer") as typeof import("../../../customer-api/testing/sample-data-layer")
            ).sampleCustomerDataLayer("linked")
          ),
        ]
      : []
  );
  return (
    <RegistryProvider initialValues={initialValues}>
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <FocusedStatusBar style="dark" />
        <AppBar
          title={m.booking_family_meeting_room_title({}, { locale })}
          onBack={onBack}
        />
        <MeetingRoomBookingScreen />
      </SafeAreaView>
    </RegistryProvider>
  );
}

// ------------------------------------------------------------ board 29: private office

function OfficeRange({
  onBack,
  opened = false,
}: {
  readonly onBack: () => void;
  readonly opened?: boolean;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Private office")}
      step="choose"
      locale={locale}
      onBack={onBack}
      at="end"
      bar={
        <BookingBar
          locale={locale}
          initiallyOpen={opened}
          summary={{
            title: sample("Mon 23 – Wed 25 Nov"),
            detail: sample("Private office · 6 seats"),
            price: quoted(officeSixSeats, locale),
          }}
          action={next(sample("Continue"))}
        />
      }
    >
      <BookingSectionHeading title={sample("First day")} first />
      <Calendar
        locale={locale}
        dates={officeDates}
        selected={officeRange.start}
        range={officeRange}
        legend={false}
      />
      <BookingSectionHeading title={sample("Days and seats")} />
      <OfficeStayControls
        steppers={{
          days: { maximum: 28, lastDate: officeRange.end },
          seats: { maximum: Option.some(6), reached: true },
        }}
        draft={{ date: Option.some(officeRange.start), dayCount: 3, seats: 6 }}
        onChange={ignore}
        locale={locale}
      />
    </FlowScreen>
  );
}

/**
 * The real office screen over the sample Workspace, without signing in, so
 * a capture reaches its live states. The gallery's route params reach it:
 * a booked stay (`&date=…&endDate=…&seats=6`) or `&restart=hold_expired`.
 */
function OfficeLive({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const [initialValues] = useState(() =>
    __DEV__
      ? [
          Atom.initialValue(
            customerDataLayer,
            (
              require("../../../customer-api/testing/sample-data-layer") as typeof import("../../../customer-api/testing/sample-data-layer")
            ).sampleCustomerDataLayer("linked")
          ),
        ]
      : []
  );
  return (
    <RegistryProvider initialValues={initialValues}>
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <FocusedStatusBar style="dark" />
        <AppBar
          title={m.booking_family_office_title({}, { locale })}
          onBack={onBack}
        />
        <OfficeBookingScreen />
      </SafeAreaView>
    </RegistryProvider>
  );
}

// ------------------------------------------------------------ boards 30–31: your details

/** The boards' booker, Jana, with her saved invoice address. */
const jana = (sample: (text: string) => string): DetailsProfile => ({
  self: {
    email: "jana.novakova@example.com",
    name: Option.some(sample("Jana Nováková")),
    phone: Option.some("+420 601 234 567"),
  },
  saved: {
    address: Option.some({
      line1: sample("Křižíkova 12"),
      city: sample("Prague 8"),
      postalCode: "186 00",
      country: "CZ",
    }),
    company: Option.none(),
  },
});

type DetailsFrameState =
  | "self"
  | "someone"
  | "company"
  | "company-lookup"
  | "errors"
  | "holding";

const detailsDraftFor = (
  state: DetailsFrameState,
  sample: (text: string) => string
): DetailsDraft => {
  // The boards show a customer in Czechia.
  const start = initialDetailsDraft(
    { address: Option.none(), company: Option.none() },
    homeCountry
  );
  switch (state) {
    case "self":
    case "holding":
      return { ...start, billing: "personal-invoice" };
    case "someone":
      return {
        ...start,
        bookingFor: "someone-else",
        someoneElse: {
          name: sample("Petr Svoboda"),
          email: "petr.svoboda@exam",
          phone: "",
        },
      };
    case "company":
      return {
        ...start,
        billing: "business",
        company: {
          legalName: sample("Svoboda Studio s.r.o."),
          companyId: "27082440",
          vatId: "",
          address: {
            line1: sample("Sokolovská 87"),
            city: sample("Prague"),
            postalCode: "186 00",
            country: "CZ",
          },
        },
      };
    // Board 30b's lookup frames: an empty company form, the IČO to type.
    case "company-lookup":
      return { ...start, billing: "business" };
    case "errors":
      return {
        ...start,
        billing: "personal-invoice",
        personalAddress: {
          line1: "",
          city: "",
          postalCode: "186 00",
          country: "CZ",
        },
      };
  }
};

/**
 * Board 30b: the details step's company form with a live company lookup,
 * answered by the sample data's fake Workspace (`12345679` and `00000019`
 * are found, `00000027` finds the registry unavailable, any other ID none).
 */
function DetailsCompanyLookup({ onBack }: { readonly onBack: () => void }) {
  // As in `CoworkLive`: the fake Workspace never ships in release bundles.
  const [initialValues] = useState(() =>
    __DEV__
      ? [
          Atom.initialValue(
            customerDataLayer,
            (
              require("../../../customer-api/testing/sample-data-layer") as typeof import("../../../customer-api/testing/sample-data-layer")
            ).sampleCustomerDataLayer("linked")
          ),
        ]
      : []
  );
  return (
    <RegistryProvider initialValues={initialValues}>
      <Details onBack={onBack} state="company-lookup" />
    </RegistryProvider>
  );
}

/**
 * Boards 30 and 31: the real details step with the boards' data. The
 * errors frame has no saved address, so "Invoice to me" asks for one.
 */
function Details({
  onBack,
  state,
}: {
  readonly onBack: () => void;
  readonly state: DetailsFrameState;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  const profile = jana(sample);
  const [draft, setDraft] = useState(() => detailsDraftFor(state, sample));
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FocusedStatusBar style="dark" />
      <AppBar title={m.booking_details_title({}, { locale })} onBack={onBack} />
      <DetailsStep
        profile={
          state === "errors"
            ? {
                ...profile,
                saved: { ...profile.saved, address: Option.none() },
              }
            : profile
        }
        initials={Option.some("JN")}
        onEditProfile={Option.some(ignore)}
        draft={draft}
        onDraftChange={setDraft}
        notice={Option.none()}
        busy={state === "holding"}
        summary={{
          title: sample("Thu 26 Nov, until 17:00"),
          detail: sample("Open Space desk · coffee"),
          price: quoted(openSpaceWithCoffee, locale, czk(340)),
        }}
        consentLocale={locale}
        onOpenMarketingDocument={ignore}
        onContinue={ignore}
        onRetry={ignore}
        locale={locale}
        initialProblems={
          state === "errors"
            ? { "address.line1": "required", "address.city": "required" }
            : undefined
        }
      />
    </SafeAreaView>
  );
}

// ------------------------------------------------------------ boards 32–35: review and pay

// ------------------------------------------------------------ the frame list

/** Every proposed frame this ticket's pieces appear in, in board order. */
export const boardFrames: ReadonlyArray<BoardFrame> = [
  ...bookTabFrames,
  {
    key: "cowork-live",
    board: "26",
    state: "The cowork screen over sample data",
    Screen: CoworkLive,
  },
  { key: "cowork-start", board: "26", state: "Start", Screen: CoworkStart },
  {
    key: "cowork-chosen",
    board: "26",
    state: "Date and extras chosen",
    Screen: CoworkChosen,
  },
  {
    key: "cowork-overnight",
    board: "26",
    state: "Reserved Desk overnight",
    Screen: CoworkOvernight,
  },
  {
    key: "cowork-full-day",
    board: "26b",
    state: "Full day tapped",
    Screen: CoworkFullDay,
  },
  {
    key: "cowork-price-opened",
    board: "26b",
    state: "Price opened: desk, discount, coffee",
    Screen: ({ onBack }) => <CoworkChosen onBack={onBack} opened />,
  },
  {
    key: "reserved-desk-price-opened",
    board: "26b",
    state: "Price opened: reserved desk with workstation",
    Screen: ReservedDeskOpened,
  },
  {
    key: "cowork-loading",
    board: "27",
    state: "Loading",
    Screen: CoworkLoading,
  },
  {
    key: "cowork-price-error",
    board: "27",
    state: "Price couldn’t load",
    Screen: CoworkPriceError,
  },
  {
    key: "cowork-restart",
    board: "27",
    state: "Back after the hold ran out",
    Screen: CoworkRestart,
  },
  {
    key: "cowork-czech",
    board: "27",
    state: "Czech strings",
    Screen: CoworkCzech,
  },
  {
    key: "meeting-room-live",
    board: "28",
    state: "The meeting-room screen over sample data",
    Screen: MeetingRoomLive,
  },
  {
    key: "meeting-room-start",
    board: "28",
    state: "Start",
    Screen: MeetingRoomStart,
  },
  {
    key: "meeting-room-chosen",
    board: "28",
    state: "Length and start time",
    Screen: MeetingRoom,
  },
  {
    key: "meeting-room-early",
    board: "28",
    state: "Early setup",
    Screen: ({ onBack }) => <MeetingRoom onBack={onBack} early />,
  },
  {
    key: "meeting-room-whole-day",
    board: "28b",
    state: "Whole day",
    Screen: MeetingRoomWholeDay,
  },
  {
    key: "meeting-room-none-left",
    board: "28b",
    state: "Nothing left for that length",
    Screen: MeetingRoomNoneLeftFrame,
  },
  {
    key: "meeting-room-price-opened",
    board: "28b",
    state: "Price opened",
    Screen: ({ onBack }) => <MeetingRoom onBack={onBack} opened />,
  },
  {
    key: "office-live",
    board: "29",
    state: "The office screen over sample data",
    Screen: OfficeLive,
  },
  {
    key: "office-range",
    board: "29",
    state: "Seat limit reached",
    Screen: OfficeRange,
  },
  {
    key: "office-price-opened",
    board: "29b",
    state: "Price opened, days and seats chosen",
    Screen: ({ onBack }) => <OfficeRange onBack={onBack} opened />,
  },
  {
    key: "details",
    board: "30",
    state: "Booking for yourself",
    Screen: ({ onBack }) => <Details onBack={onBack} state="self" />,
  },
  {
    key: "details-someone",
    board: "30",
    state: "Booking for someone else",
    Screen: ({ onBack }) => <Details onBack={onBack} state="someone" />,
  },
  {
    key: "details-company",
    board: "30",
    state: "Invoice to a company",
    Screen: ({ onBack }) => <Details onBack={onBack} state="company" />,
  },
  {
    key: "details-company-lookup",
    board: "30b",
    state: "Company lookup",
    Screen: ({ onBack }) => <DetailsCompanyLookup onBack={onBack} />,
  },
  {
    key: "details-errors",
    board: "31",
    state: "Errors",
    Screen: ({ onBack }) => <Details onBack={onBack} state="errors" />,
  },
  {
    key: "details-holding",
    board: "31",
    state: "Holding your spot",
    Screen: ({ onBack }) => <Details onBack={onBack} state="holding" />,
  },
  ...reviewFrames,
];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  // The row's own gutter would inset the box; the board puts it on the
  // screen's.
  earlySetup: { marginHorizontal: -space.lg, marginTop: space.xl },
  banner: {
    backgroundColor: color.paper,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    paddingBottom: space.sm,
    paddingHorizontal: space.gutter,
  },
  body: { flex: 1 },
  priceCard: { padding: space.lg },
  bodyContent: {
    paddingBottom: space.xxl,
    paddingHorizontal: space.gutter,
    paddingTop: space.xs,
  },
  placeholder: {
    alignItems: "center",
    backgroundColor: color.sunken,
    borderColor: color.line,
    borderRadius: radius.tile,
    borderStyle: "dashed",
    borderWidth: 1,
    justifyContent: "center",
    marginVertical: space.xs,
    padding: space.md,
  },
});
