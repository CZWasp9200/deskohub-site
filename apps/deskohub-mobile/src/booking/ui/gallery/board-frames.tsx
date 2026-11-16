import type {
  CustomerCheckoutSummary,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import Coffee from "lucide-react-native/icons/coffee";
import Lock from "lucide-react-native/icons/lock";
import Monitor from "lucide-react-native/icons/monitor";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppLocale } from "../../../i18n/app-locale";
import { useAppLocale } from "../../../i18n/locale-context";
import { m } from "../../../i18n/messages";
import { AppBar } from "../../../ui/app-bar";
import { Card } from "../../../ui/card";
import { FocusedStatusBar } from "../../../ui/focused-status-bar";
import { useSample } from "../../../ui/gallery/gallery-kit";
import { Notice } from "../../../ui/notice";
import { Text } from "../../../ui/text";
import { color, radius, space } from "../../../ui/tokens";
import {
  type DetailsDraft,
  type DetailsProfile,
  initialDetailsDraft,
} from "../../checkout-screen/details-form";
import { DetailsStep } from "../../checkout-screen/details-step";
import { CoworkSkeleton } from "../../family/cowork-booking-screen";
import {
  type CoworkTierCard,
  CoworkTierCards,
  tierArtwork,
} from "../../family/cowork-tier-cards";
import { RestartNotice } from "../../family/restart-notice";
import type { DateChoice } from "../../selection/booking-selection";
import type { PragueDate } from "../../selection/prague-date";
import { czk } from "../../testing/sample-booking-catalog";
import { AddonOptions, AddonToggle } from "../addon-toggle";
import {
  BookingBar,
  type BookingBarAction,
  type BookingBarPrice,
} from "../booking-bar";
import { BookingSectionHeading } from "../booking-section-heading";
import { type BookingStep, BookingSteps } from "../booking-steps";
import {
  HoldEndedDialog,
  type HoldStatus,
  HoldStatusChip,
} from "../hold-timer";
import { MonthCalendar } from "../month-calendar";
import type { CalendarRange } from "../month-calendar-model";
import { priceBreakdown } from "../price-breakdown";
import { describePriceLine } from "../price-line-description";
import { PriceLines } from "../price-lines";
import {
  meetingRoomHour,
  officeSixSeats,
  openSpaceWithCoffee,
  type PriceFixture,
  reservedDeskWithWorkstation,
} from "../testing/price-fixtures";

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

const today: PragueDate = "2026-11-10";
const coworkDates: DateChoice = {
  earliest: today,
  latest: "2027-01-31",
  unavailable: new Set(["2026-11-20"]),
};
const officeDates: DateChoice = {
  ...coworkDates,
  unavailable: new Set(["2026-11-14", "2026-11-15"]),
};
const officeRange: CalendarRange = { start: "2026-11-23", end: "2026-11-25" };
const chosenDay: PragueDate = "2026-11-26";
const fullDay: PragueDate = "2026-11-20";

const hold = {
  review: { secondsLeft: 597, phase: "held" },
  codeApplied: { secondsLeft: 545, phase: "held" },
  lastMinute: { secondsLeft: 58, phase: "ending" },
  ended: { secondsLeft: 0, phase: "ended" },
  paying: { secondsLeft: 509, phase: "held" },
} as const satisfies Record<string, HoldStatus>;

/** Board 32's applied code: 10% off the desk after the calendar discount. */
const openSpaceWithCode: PriceFixture = (() => {
  const total = czk(258.8);
  const summary: CustomerCheckoutSummary = {
    sections: [
      {
        key: "order",
        items: [
          {
            key: "product:cowork:open-space",
            amount: czk(208.8),
            originalAmount: czk(290),
            discounts: [
              {
                discount: {
                  id: "calendar-sale-2026-11",
                  label: "Calendar discount",
                },
                amount: czk(58),
              },
              {
                discount: { id: "code-welcome10", label: "Code WELCOME10" },
                amount: czk(23.2),
              },
            ],
          },
          { key: "addon:coffee", amount: czk(50) },
        ],
        total,
      },
      { key: "total", items: [{ key: "total:final", amount: total }], total },
    ],
    total,
  };
  return { selection: openSpaceWithCoffee.selection, summary };
})();

const quoted = (
  { selection, summary }: PriceFixture,
  locale: AppLocale,
  was?: Money
): BookingBarPrice => ({
  kind: "quoted",
  breakdown: priceBreakdown(summary),
  describeLine: describePriceLine(selection, locale),
  was,
});

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

/** Screen content another ticket builds, at the board's height. */
function Placeholder({
  label,
  height,
}: {
  readonly label: string;
  readonly height: number;
}) {
  return (
    <View style={[styles.placeholder, { minHeight: height }]}>
      <Text variant="bodySmall" tone="muted">
        {label}
      </Text>
    </View>
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

function MeetingRoom({
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
      title={sample("Meeting room")}
      step="choose"
      locale={locale}
      onBack={onBack}
      at={opened ? "end" : "top"}
      bar={
        <BookingBar
          locale={locale}
          initiallyOpen={opened}
          summary={{
            title: sample("Wed 18 Nov, 14:00–15:00"),
            detail: sample(
              opened ? "Meeting room · in from 13:45" : "Meeting room · 1 hour"
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
      <Placeholder label="Lengths with prices (screen ticket)" height={176} />
      <BookingSectionHeading title={sample("Start time")} />
      <Placeholder label="Start times (screen ticket)" height={208} />
      {opened && (
        <Placeholder
          label="Come 15 minutes early (screen ticket)"
          height={48}
        />
      )}
    </FlowScreen>
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
      <Placeholder
        label="Days and seats steppers (screen ticket)"
        height={152}
      />
    </FlowScreen>
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

type DetailsFrameState = "self" | "someone" | "company" | "errors" | "holding";

const detailsDraftFor = (
  state: DetailsFrameState,
  sample: (text: string) => string
): DetailsDraft => {
  const start = initialDetailsDraft({
    address: Option.none(),
    company: Option.none(),
  });
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

/** The review's price card (`.bk-card` with `.bk-li` rows and the total). */
function PriceCard({
  fixture,
  was,
  locale,
}: {
  readonly fixture: PriceFixture;
  readonly was?: Money;
  readonly locale: AppLocale;
}) {
  const sample = useSample();
  return (
    // The board's price card (`.bk-card`) is inset 16, not the card's 20.
    <Card padding="none">
      <View style={styles.priceCard}>
        <PriceLines
          breakdown={priceBreakdown(fixture.summary)}
          describeLine={describePriceLine(fixture.selection, locale)}
          locale={locale}
          variant="card"
          total={{ label: sample("Total"), was }}
        />
      </View>
    </Card>
  );
}

const payLabel = (amount: string) => `Order and pay ${amount}`;

function ReviewTop({
  onBack,
  ended = false,
}: {
  readonly onBack: () => void;
  readonly ended?: boolean;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Review and pay")}
      step="pay"
      locale={locale}
      onBack={onBack}
      hold={ended ? hold.ended : hold.review}
      bar={
        ended ? (
          <BookingBar
            locale={locale}
            action={next(sample(payLabel("CZK 282")), { icon: Lock })}
          />
        ) : (
          <BookingBar
            locale={locale}
            action={next(sample(payLabel("CZK 282")), { disabled: true })}
            reason={sample("Tick the agreement to pay")}
          />
        )
      }
      overlay={
        ended && (
          <HoldEndedDialog
            visible
            onCheckDate={ignore}
            onLeave={ignore}
            locale={locale}
          />
        )
      }
    >
      <BookingSectionHeading
        title={sample("Your booking")}
        aside={sample("Change")}
        first
      />
      <Placeholder label="Booking summary (screen ticket)" height={196} />
      <BookingSectionHeading title={sample("Price")} />
      <PriceCard fixture={openSpaceWithCoffee} locale={locale} />
      <Placeholder label="Discount code row (screen ticket)" height={48} />
      <Placeholder label="Agreement (screen ticket)" height={120} />
    </FlowScreen>
  );
}

function ReviewCodeApplied({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Review and pay")}
      step="pay"
      locale={locale}
      onBack={onBack}
      hold={hold.codeApplied}
      raised
      bar={
        <BookingBar
          locale={locale}
          action={next(sample(payLabel("CZK 258.80")), { disabled: true })}
          reason={sample("Tick the agreement to pay")}
        />
      }
    >
      <BookingSectionHeading title={sample("Price")} first />
      <PriceCard fixture={openSpaceWithCode} was={czk(282)} locale={locale} />
      <Placeholder
        label="Code applied, with Remove (screen ticket)"
        height={64}
      />
      <Placeholder label="Agreement (screen ticket)" height={120} />
    </FlowScreen>
  );
}

function ReviewLastMinute({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Review and pay")}
      step="pay"
      locale={locale}
      onBack={onBack}
      hold={hold.lastMinute}
      at="end"
      banner={
        <Notice
          tone="warning"
          title={sample("Less than a minute left to pay")}
          message={sample(
            "If time runs out we release the spot, but keep your choices."
          )}
        />
      }
      bar={
        <BookingBar
          locale={locale}
          action={next(sample(payLabel("CZK 282")), { icon: Lock })}
        />
      }
    >
      <BookingSectionHeading
        title={sample("Your booking")}
        aside={sample("Change")}
        first
      />
      <Placeholder label="Booking summary (screen ticket)" height={196} />
      <BookingSectionHeading title={sample("Price")} />
      <PriceCard fixture={openSpaceWithCoffee} locale={locale} />
      <Placeholder label="Discount code row (screen ticket)" height={48} />
      <Placeholder label="Agreement, ticked (screen ticket)" height={120} />
    </FlowScreen>
  );
}

function PayBusy({ onBack }: { readonly onBack: () => void }) {
  const locale = useAppLocale();
  const sample = useSample();
  return (
    <FlowScreen
      title={sample("Review and pay")}
      step="pay"
      locale={locale}
      onBack={onBack}
      hold={hold.paying}
      at="end"
      bar={
        <BookingBar
          locale={locale}
          action={next(sample("Opening payment…"), {
            busy: true,
            disabled: true,
          })}
        />
      }
    >
      <BookingSectionHeading
        title={sample("Your booking")}
        aside={sample("Change")}
        first
      />
      <Placeholder label="Booking summary (screen ticket)" height={196} />
      <BookingSectionHeading title={sample("Price")} />
      <PriceCard fixture={openSpaceWithCode} was={czk(282)} locale={locale} />
      <Placeholder
        label="Code applied, with Remove (screen ticket)"
        height={64}
      />
      <Placeholder label="Agreement, ticked (screen ticket)" height={120} />
    </FlowScreen>
  );
}

// ------------------------------------------------------------ the frame list

/** Every proposed frame this ticket's pieces appear in, in board order. */
export const boardFrames: ReadonlyArray<BoardFrame> = [
  { key: "cowork-start", board: "26", state: "Start", Screen: CoworkStart },
  {
    key: "cowork-chosen",
    board: "26",
    state: "Date and extras chosen",
    Screen: CoworkChosen,
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
    key: "meeting-room-chosen",
    board: "28",
    state: "Length and start time",
    Screen: MeetingRoom,
  },
  {
    key: "meeting-room-price-opened",
    board: "28",
    state: "Price opened",
    Screen: ({ onBack }) => <MeetingRoom onBack={onBack} opened />,
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
  { key: "review", board: "32", state: "Review", Screen: ReviewTop },
  {
    key: "review-code-applied",
    board: "32",
    state: "Code applied",
    Screen: ReviewCodeApplied,
  },
  {
    key: "review-last-minute",
    board: "33",
    state: "Last minute",
    Screen: ReviewLastMinute,
  },
  {
    key: "review-hold-ended",
    board: "33",
    state: "Hold ended",
    Screen: ({ onBack }) => <ReviewTop onBack={onBack} ended />,
  },
  {
    key: "pay-busy",
    board: "35",
    state: "Leaving the app",
    Screen: PayBusy,
  },
];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
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
