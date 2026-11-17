import type { CustomerVatStatus } from "@deskohub/workspace-customer-api";
import Lock from "lucide-react-native/icons/lock";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import type { AppLocale } from "../../../i18n/app-locale";
import { useAppLocale } from "../../../i18n/locale-context";
import { Card } from "../../../ui/card";
import {
  GalleryCase,
  GallerySection,
  useSample,
} from "../../../ui/gallery/gallery-kit";
import { ScrollScreen } from "../../../ui/scroll-screen";
import { Text } from "../../../ui/text";
import { color, radius, space } from "../../../ui/tokens";
import { czk } from "../../testing/sample-booking-catalog";
import { BookingBar } from "../booking-bar";
import { priceBreakdown } from "../price-breakdown";
import { describePriceLine } from "../price-line-description";
import { PriceLines } from "../price-lines";
import {
  meetingRoomHour,
  officeSixSeats,
  officeSixSeatsDiscounted,
  openSpaceWithCoffee,
  reservedDeskWithWorkstation,
} from "../testing/price-fixtures";
import { quotedPrice } from "./gallery-fixtures";

type BarProps = ComponentProps<typeof BookingBar>;

const noop = () => undefined;

/** Every bar state on boards 26–36, as fixture data. */
const barStates = (
  locale: AppLocale,
  sample: (text: string) => string
): ReadonlyArray<{ readonly label: string; readonly props: BarProps }> => {
  const next = (overrides: Partial<BarProps["action"]> = {}) => ({
    label: sample("Continue"),
    onPress: noop,
    ...overrides,
  });
  return [
    {
      label: "Start: from-price, no date yet",
      props: {
        locale,
        summary: {
          title: sample("Open Space desk"),
          price: {
            kind: "from",
            amount: czk(232),
            was: czk(290),
            unit: sample("per day"),
          },
        },
        action: next({ disabled: true }),
        reason: sample("Choose a date to continue"),
      },
    },
    {
      label: "Chosen, with the price before the discount",
      props: {
        locale,
        summary: {
          title: sample("Thu 26 Nov, until 17:00"),
          detail: sample("Open Space desk · coffee"),
          price: quotedPrice(openSpaceWithCoffee, locale, czk(340)),
        },
        action: next(),
      },
    },
    {
      label: "Updating the price",
      props: {
        locale,
        summary: {
          title: sample("Thu 26 Nov, until 17:00"),
          detail: sample("Open Space desk · coffee"),
          price: { kind: "updating" },
        },
        action: next({ disabled: true }),
      },
    },
    {
      label: "Quote failed",
      props: {
        locale,
        summary: {
          title: sample("Thu 26 Nov, until 17:00"),
          detail: sample("Open Space desk · coffee"),
          price: { kind: "none" },
        },
        action: next({ label: sample("Try again"), icon: RotateCcw }),
      },
    },
    {
      label: "Long Czech summary: every line wraps",
      props: {
        locale: "cs-CZ",
        summary: {
          title: sample("Čtvrtek 26. listopadu 2026, od 8:00 do 17:00"),
          detail: sample(
            "Rezervované místo · pracovní stanice s monitory 2× 27″ QHD · káva"
          ),
          price: quotedPrice(reservedDeskWithWorkstation, "cs-CZ", czk(530)),
        },
        action: next({ label: sample("Pokračovat") }),
      },
    },
  ];
};

/** Each breakdown opened, one per booking family. */
const openedStates = (
  locale: AppLocale,
  sample: (text: string) => string
): ReadonlyArray<{ readonly label: string; readonly props: BarProps }> =>
  (
    [
      [
        "Open Space, discount and coffee",
        "Thu 26 Nov, until 17:00",
        "Open Space desk · coffee",
        openSpaceWithCoffee,
        czk(340),
      ],
      [
        "Reserved desk and workstation",
        "Thu 26 Nov, until 17:00",
        "Reserved desk · 2× 27″ QHD",
        reservedDeskWithWorkstation,
        czk(530),
      ],
      [
        "Meeting room",
        "Thu 26 Nov, 14:00–15:00",
        "Meeting room · 1 hour",
        meetingRoomHour,
        czk(350),
      ],
      [
        "Private office",
        "Mon 23 – Wed 25 Nov",
        "Private office · 6 seats",
        officeSixSeats,
        undefined,
      ],
      [
        "Private office, discounted",
        "Mon 23 – Wed 25 Nov",
        "Private office · 6 seats",
        officeSixSeatsDiscounted,
        czk(7260),
      ],
    ] as const
  ).map(([label, title, detail, fixture, was]) => ({
    label: `Opened: ${label}`,
    props: {
      locale,
      initiallyOpen: true,
      summary: {
        title: sample(title),
        detail: sample(detail),
        price: quotedPrice(fixture, locale, was),
      },
      action: { label: sample("Continue"), onPress: noop },
    },
  }));

/** The Pay step's bar: the button alone, with its reason when it is off. */
const payStates = (
  locale: AppLocale,
  sample: (text: string) => string
): ReadonlyArray<{ readonly label: string; readonly props: BarProps }> => [
  {
    label: "Pay: off until the agreement is ticked",
    props: {
      locale,
      action: {
        label: sample("Order and pay CZK 282"),
        onPress: noop,
        disabled: true,
      },
      reason: sample("Tick the agreement to pay"),
    },
  },
  {
    label: "Pay: ready",
    props: {
      locale,
      action: {
        label: sample("Order and pay CZK 282"),
        onPress: noop,
        icon: Lock,
      },
    },
  },
  {
    label: "Pay: opening the payment",
    props: {
      locale,
      action: {
        label: sample("Opening payment…"),
        onPress: noop,
        busy: true,
        disabled: true,
      },
    },
  },
];

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A bar shown inside the list, without the gesture bar's padding. */
function InlineBar(props: BarProps) {
  return (
    <SafeAreaInsetsContext.Provider value={noInsets}>
      <View style={styles.inline}>
        <BookingBar {...props} />
      </View>
    </SafeAreaInsetsContext.Provider>
  );
}

/** A phone-height frame: a page body with the bar pinned under it, as the boards draw it. */
function Frame({ children }: { readonly children: ReactNode }) {
  const sample = useSample();
  return (
    <SafeAreaInsetsContext.Provider value={noInsets}>
      <View style={styles.frame}>
        <View style={styles.frameBody}>
          {["Desk type", "Date", "Add-ons"].map((title) => (
            <Card key={title}>
              <Text variant="headline">{sample(title)}</Text>
              <View style={styles.placeholder} />
            </Card>
          ))}
        </View>
        {children}
      </View>
    </SafeAreaInsetsContext.Provider>
  );
}

/**
 * The booking bar in every state (boards 26–36), each breakdown opened, the
 * Pay step's bar, the review's price card with and without a tax note, and
 * a full-screen frame per bar state for device captures.
 */
export function PriceGallerySection() {
  const locale = useAppLocale();
  const sample = useSample();
  const bars = barStates(locale, sample);
  const opened = openedStates(locale, sample);
  const pay = payStates(locale, sample);
  // The note shows only for a VAT payer; its sample wording is not approved copy.
  const card = (vatStatus: CustomerVatStatus, taxNote?: string) => (
    <Card>
      <PriceLines
        breakdown={priceBreakdown({
          ...openSpaceWithCoffee.summary,
          vatStatus,
        })}
        describeLine={describePriceLine(openSpaceWithCoffee.selection, locale)}
        locale={locale}
        variant="card"
        total={{ label: sample("Total to pay"), was: czk(340), taxNote }}
      />
    </Card>
  );
  return (
    <ScrollScreen>
      <GallerySection title="Booking bar">
        {[...bars, ...opened].map(({ label, props }) => (
          <GalleryCase key={label} label={label}>
            <InlineBar {...props} />
          </GalleryCase>
        ))}
      </GallerySection>
      <GallerySection title="Pay step bar">
        {pay.map(({ label, props }) => (
          <GalleryCase key={label} label={label}>
            <InlineBar {...props} />
          </GalleryCase>
        ))}
      </GallerySection>
      <GallerySection title="Price card">
        <GalleryCase label="Without a tax note (today)">
          {card("not-vat-payer")}
        </GalleryCase>
        <GalleryCase label="With the tax note slot filled">
          {card("vat-payer", sample("Prices include VAT"))}
        </GalleryCase>
      </GallerySection>
      <GallerySection title="Full-screen frames">
        {[...bars, ...opened, ...pay].map(({ label, props }) => (
          <GalleryCase key={label} label={label}>
            <Frame>
              <BookingBar {...props} />
            </Frame>
          </GalleryCase>
        ))}
      </GallerySection>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  inline: { borderRadius: radius.group, overflow: "hidden" },
  frame: {
    backgroundColor: color.paper,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    height: 720,
    overflow: "hidden",
  },
  frameBody: {
    flex: 1,
    gap: space.lg,
    overflow: "hidden",
    padding: space.gutter,
  },
  placeholder: {
    backgroundColor: color.sunken,
    borderRadius: radius.tile,
    height: 96,
    marginTop: space.md,
  },
});
