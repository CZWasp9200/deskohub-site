import type { Money } from "@deskohub/workspace-customer-api";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import Info from "lucide-react-native/icons/info";
import { useRef, useState } from "react";
import {
  type GestureResponderEvent,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { Button } from "../../ui/controls";
import { Icon, type IconComponent } from "../../ui/icon";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { idleLiveRegionLayout } from "../../ui/notice-presentation";
import { useReducedMotion } from "../../ui/reduced-motion";
import { Text } from "../../ui/text";
import { useToastObstruction } from "../../ui/toast";
import { color, space, touchTarget, typeScale } from "../../ui/tokens";
import type { PriceBreakdown, PriceLine } from "./price-breakdown";
import type { PriceLineDescription } from "./price-line-description";
import { PriceLines, wasPriceLabel } from "./price-lines";

/** What the bar shows on the right of its summary. */
export type BookingBarPrice =
  /** Nothing priced yet: loading, or the quote failed. */
  | { readonly kind: "none" }
  /** A new quote is on its way: "Updating price…", announced. */
  | { readonly kind: "updating" }
  /**
   * A price before the selection is complete: the from-price with its unit
   * such as "per day", or a chosen option's price without one. It opens
   * only when `itemized` gives the lines it adds up from.
   */
  | {
      readonly kind: "from";
      readonly amount: Money;
      readonly was?: Money;
      readonly unit?: string;
      readonly itemized?: ItemizedPrice;
    }
  /** The quoted total, which opens to its itemized lines. */
  | {
      readonly kind: "quoted";
      readonly breakdown: PriceBreakdown;
      readonly describeLine: (line: PriceLine) => PriceLineDescription;
      readonly was?: Money;
    };

/** The lines a price opens to, and how each reads. */
export interface ItemizedPrice {
  readonly breakdown: PriceBreakdown;
  readonly describeLine: (line: PriceLine) => PriceLineDescription;
}

/** The lines the bar's price opens to; none when it doesn't open. */
const itemizedPriceOf = (
  price: BookingBarPrice | undefined
): ItemizedPrice | undefined => {
  if (price?.kind === "quoted") return price;
  return price?.kind === "from" ? price.itemized : undefined;
};

/** What and when is booked, and its price. */
export interface BookingBarSummary {
  /** What and when, bold; wraps, never cut. */
  readonly title: string;
  /** The grey line under it, such as the add-ons; one line, truncated. */
  readonly detail?: string;
  readonly price: BookingBarPrice;
}

/** The screen's one action, under the summary. */
export interface BookingBarAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly icon?: IconComponent;
}

/** A finger's travel since it touched the bar, in dp. */
export interface SwipeTravel {
  readonly dx: number;
  readonly dy: number;
}

// A finger that moves further than a tap's jitter, mostly up or down, is
// swiping the bar; one that travels this far opens or closes it.
const swipeSlop = 10;
const swipeDistance = 24;

/** Whether a finger's travel is a vertical swipe the bar takes over from a press. */
export const claimsSwipe = ({ dx, dy }: SwipeTravel): boolean =>
  Math.abs(dy) > swipeSlop && Math.abs(dy) > Math.abs(dx);

/** What a finished swipe asks for: up opens, down closes, a short or sideways one nothing. */
export const swipeIntent = ({
  dx,
  dy,
}: SwipeTravel): "open" | "close" | undefined => {
  if (Math.abs(dy) <= Math.abs(dx)) return undefined;
  if (dy <= -swipeDistance) return "open";
  if (dy >= swipeDistance) return "close";
  return undefined;
};

// The board's arrow strip, and how far the content under it moves up.
const grabStrip = 20;
const grabOverlap = 6;

// The opened list takes at most this share of the window, then scrolls.
const openListShare = 0.45;

/**
 * The sticky footer of a booking screen: what and when on the left, the
 * price on the right, the screen's one action under them and, under the
 * action, why it is off. A quoted price, or a from-price given its lines,
 * opens to its itemized lines above the summary: tap the summary or the grey arrow, or swipe the bar up;
 * swipe down or tap again to close. The arrow is the accessible toggle.
 * Without a `summary` the bar is the action alone (the Pay step). Toasts
 * rise above the bar.
 */
export function BookingBar({
  summary,
  action,
  reason,
  reasonTone = "info",
  locale,
  initiallyOpen = false,
}: {
  readonly summary?: BookingBarSummary;
  readonly action: BookingBarAction;
  /** Why the action is off, under it; announced when it changes. */
  readonly reason?: string;
  /**
   * How the reason reads: `info` (grey, info icon; why the action is off),
   * `plain` (grey, no icon; a note such as how long the spot is held) or
   * `error` (crimson, alert icon; what to fix before continuing).
   */
  readonly reasonTone?: BookingBarReasonTone;
  readonly locale: AppLocale;
  /** Draws the breakdown open at first; for the gallery and captures. */
  readonly initiallyOpen?: boolean;
}) {
  const { bottom } = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  useToastObstruction(height);
  const reducedMotion = useReducedMotion() !== false;
  const [open, setOpen] = useState(initiallyOpen);
  const itemized = itemizedPriceOf(summary?.price);
  // The breakdown closes when the price stops being itemized.
  if (open && itemized === undefined) setOpen(false);
  const shownOpen = open && itemized !== undefined;

  const toggle = (next: boolean) => {
    if (itemized === undefined || next === shownOpen) return;
    if (!reducedMotion) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setOpen(next);
  };

  const touchStart = useRef({ x: 0, y: 0 });
  const travel = ({ nativeEvent }: GestureResponderEvent): SwipeTravel => ({
    dx: nativeEvent.pageX - touchStart.current.x,
    dy: nativeEvent.pageY - touchStart.current.y,
  });
  // The arrow and the summary row take a vertical swipe from the presses
  // inside them; the opened list keeps its own scrolling.
  const swipeResponder = {
    onStartShouldSetResponderCapture: ({
      nativeEvent,
    }: GestureResponderEvent) => {
      touchStart.current = { x: nativeEvent.pageX, y: nativeEvent.pageY };
      return false;
    },
    onMoveShouldSetResponderCapture: (event: GestureResponderEvent) =>
      itemized !== undefined && claimsSwipe(travel(event)),
    onResponderTerminationRequest: () => true,
    onResponderRelease: (event: GestureResponderEvent) => {
      const intent = swipeIntent(travel(event));
      if (intent !== undefined) toggle(intent === "open");
    },
  };

  const detailsLabel = shownOpen
    ? m.booking_price_hide_details({}, { locale })
    : m.booking_price_show_details({}, { locale });

  return (
    <View
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[
        styles.bar,
        summary === undefined ? styles.actionOnly : styles.withSummary,
        shownOpen && styles.open,
        { paddingBottom: space.md + bottom },
      ]}
    >
      {summary !== undefined && (
        <View style={styles.summaryArea}>
          {itemized !== undefined && (
            <View {...swipeResponder} style={styles.grabArea}>
              <Pressable
                role="button"
                aria-label={detailsLabel}
                aria-expanded={shownOpen}
                onPress={() => toggle(!shownOpen)}
                style={styles.grab}
              >
                <Chevron open={shownOpen} />
              </Pressable>
            </View>
          )}
          {itemized !== undefined && shownOpen && (
            // Long lists scroll, so the summary and the action stay on screen.
            <ScrollView
              bounces={false}
              style={{ maxHeight: windowHeight * openListShare }}
            >
              <PriceLines
                breakdown={itemized.breakdown}
                describeLine={itemized.describeLine}
                locale={locale}
                variant="bar"
              />
            </ScrollView>
          )}
          <View {...swipeResponder}>
            <Pressable
              // A pointer convenience: the arrow is the accessible toggle.
              accessible={false}
              focusable={false}
              disabled={itemized === undefined}
              onPress={() => toggle(!shownOpen)}
              style={styles.summary}
            >
              <View style={styles.what}>
                <Text style={styles.title}>{summary.title}</Text>
                {summary.detail !== undefined && summary.detail !== "" && (
                  <Text style={styles.detail}>{summary.detail}</Text>
                )}
              </View>
              <BarPrice price={summary.price} locale={locale} />
            </Pressable>
          </View>
        </View>
      )}
      <Button
        label={action.label}
        onPress={action.onPress}
        disabled={action.disabled}
        busy={action.busy}
        icon={action.icon}
      />
      <Reason reason={reason} tone={reasonTone} />
    </View>
  );
}

/** The grey arrow: up while closed, down while open. Drawn at the board's 22, hidden as the toggle names itself. */
function Chevron({ open }: { readonly open: boolean }) {
  return (
    <Icon
      icon={open ? ChevronDown : ChevronUp}
      size={22}
      color={color.grabArrow}
    />
  );
}

/** What the price column shows: the amount, a struck earlier one and a unit. */
const pricedColumn = (
  price: BookingBarPrice
): { amount: Money; was?: Money; unit?: string } | undefined => {
  switch (price.kind) {
    case "from":
      return {
        amount: price.amount,
        was: price.was,
        ...(price.unit !== undefined && { unit: price.unit }),
      };
    case "quoted":
      return { amount: price.breakdown.total, was: price.was };
    default:
      return undefined;
  }
};

/**
 * The price column, centred against the summary: struck earlier price,
 * total, unit. "Updating price…" shows in a status region that stays
 * mounted across price states, so its arrival is announced.
 */
function BarPrice({
  price,
  locale,
}: {
  readonly price: BookingBarPrice;
  readonly locale: AppLocale;
}) {
  const updating =
    price.kind === "updating"
      ? m.booking_price_updating({}, { locale })
      : undefined;
  useLiveRegionAnnouncement(updating, "polite");
  const priced = pricedColumn(price);
  return (
    <>
      <View
        role="status"
        aria-live="polite"
        accessibilityLiveRegion="polite"
        style={updating === undefined ? idleLiveRegionLayout : styles.updating}
      >
        {updating !== undefined && (
          <LoadingIndicator size="inline" tone={{ color: color.action }} />
        )}
        <Text style={styles.updatingText}>{updating ?? ""}</Text>
      </View>
      {priced !== undefined && (
        <View style={styles.price}>
          {priced.was !== undefined && <Was was={priced.was} locale={locale} />}
          <Text numeric style={styles.total}>
            {formatMoney(priced.amount, locale)}
          </Text>
          {priced.unit !== undefined && (
            <Text style={styles.unit}>{priced.unit}</Text>
          )}
        </View>
      )}
    </>
  );
}

function Was({
  was,
  locale,
}: {
  readonly was: Money;
  readonly locale: AppLocale;
}) {
  return (
    <Text numeric aria-label={wasPriceLabel(was, locale)} style={styles.was}>
      {formatMoney(was, locale)}
    </Text>
  );
}

/** How the line under the action reads; see `BookingBar`'s `reasonTone`. */
export type BookingBarReasonTone = "info" | "plain" | "error";

const reasonIcon = { info: Info, plain: undefined, error: CircleAlert };

/** The line under the action (`.bk-why`), in a live region that stays mounted. */
function Reason({
  reason,
  tone,
}: {
  readonly reason: string | undefined;
  readonly tone: BookingBarReasonTone;
}) {
  const icon = reasonIcon[tone];
  const ink = tone === "error" ? color.dangerInk : color.ink2;
  const shown = reason !== undefined && reason !== "";
  useLiveRegionAnnouncement(shown ? reason : undefined, "polite");
  return (
    <View
      role="status"
      aria-live="polite"
      accessibilityLiveRegion="polite"
      style={shown ? styles.reason : idleLiveRegionLayout}
    >
      {shown && icon && <Icon icon={icon} size={16} color={ink} />}
      <Text style={[styles.reasonText, tone === "error" && styles.reasonError]}>
        {shown ? reason : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // `.ft.bk-bar`: white, a hairline on top, 10 between its parts.
  bar: {
    backgroundColor: color.surface,
    borderTopColor: color.line,
    borderTopWidth: 1,
    gap: 10,
    paddingHorizontal: space.gutter,
  },
  withSummary: { paddingTop: space.xs },
  actionOnly: { paddingTop: space.md },
  open: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    boxShadow: "0 -12px 28px -12px rgba(0, 2, 79, 0.35)",
  },
  summaryArea: { gap: 10 },
  // The arrow sits in the board's 20-tall strip on the bar's top edge, but
  // its target is a full 48 tall and spans the bar. The target overlaps the
  // summary (which toggles too) or the list's top, and sits above them, so
  // the summary starts where the board's strip ends (20 − 6 + the gap).
  grabArea: { marginBottom: grabStrip - grabOverlap - touchTarget, zIndex: 1 },
  grab: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "flex-start",
  },
  summary: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    justifyContent: "space-between",
  },
  what: { flex: 1, minWidth: 0 },
  title: { ...typeScale.subhead, color: color.navy },
  detail: { ...typeScale.hint, color: color.ink2 },
  price: { alignItems: "flex-end", flexShrink: 0 },
  was: {
    ...typeScale.hint,
    color: color.ink2,
    lineHeight: 16,
    textDecorationLine: "line-through",
  },
  total: {
    ...typeScale.titleLarge,
    color: color.navy,
    fontSize: 22,
    lineHeight: 26,
  },
  unit: { ...typeScale.hint, color: color.ink2, fontSize: 12, lineHeight: 16 },
  updating: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
    minHeight: 26,
  },
  updatingText: { ...typeScale.hint, color: color.ink2 },
  reason: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  reasonText: {
    ...typeScale.hint,
    color: color.ink2,
    flexShrink: 1,
    textAlign: "center",
  },
  // Board 31: the details step's "Fix 2 fields" note, danger ink at 500.
  reasonError: { ...typeScale.hintStrong, color: color.dangerInk },
});
