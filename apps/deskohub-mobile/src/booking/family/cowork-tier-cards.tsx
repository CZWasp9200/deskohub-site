import type {
  CustomerBookableCoworkTier,
  Money,
} from "@deskohub/workspace-customer-api";
import { type ReactNode, useState } from "react";
import {
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { RadioMark } from "../../ui/radio-card";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";

/** Artwork for the cowork tiers. */
const artwork = {
  openSpace: {
    source: require("../../../assets/images/booking/open-space.webp"),
    aspectRatio: 630 / 482,
    clearsTitle: false,
  },
  reservedDesk: {
    source: require("../../../assets/images/booking/reserved-desk.webp"),
    aspectRatio: 630 / 477,
    clearsTitle: false,
  },
  // The monitors stand tall: kept below the name and the radio.
  reservedDeskWorkstation: {
    source: require("../../../assets/images/booking/reserved-desk-workstation.webp"),
    aspectRatio: 630 / 459,
    clearsTitle: true,
  },
} satisfies Record<
  string,
  {
    readonly source: ImageSourcePropType;
    readonly aspectRatio: number;
    /** Whether the art starts below the card's name and radio. */
    readonly clearsTitle: boolean;
  }
>;

/**
 * A tier's artwork, as the website picks it: the Reserved Desk shows its
 * workstation once the customer adds one.
 */
export const tierArtwork = (
  tier: CustomerBookableCoworkTier,
  withWorkstation: boolean
) => {
  if (tier === "open-space") return artwork.openSpace;
  return withWorkstation
    ? artwork.reservedDeskWorkstation
    : artwork.reservedDesk;
};

/** One cowork tier as its card shows it. */
export interface CoworkTierCard {
  readonly tier: CustomerBookableCoworkTier;
  /** The catalog's product name. */
  readonly name: string;
  /** Today's advertised price per day. */
  readonly price: Money;
  /** The regular price, struck above it, while a sale lowers it. */
  readonly was?: Money;
  readonly description: string;
  readonly artwork: ReturnType<typeof tierArtwork>;
  /** Why the tier can't be chosen, such as the chosen day being full. */
  readonly unavailable?: string;
}

/**
 * The cowork tiers as the website's offer cards: the artwork is the card's
 * background on the right, the name and radio on top, the price on its own
 * light panel and the description highlighted where it runs over the art.
 */
export function CoworkTierCards({
  label,
  cards,
  selected,
  onSelect,
  locale,
  paired = false,
  stretch = false,
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly cards: ReadonlyArray<CoworkTierCard>;
  readonly selected: CustomerBookableCoworkTier;
  readonly onSelect: (tier: CustomerBookableCoworkTier) => void;
  readonly locale: AppLocale;
  readonly paired?: boolean;
  readonly stretch?: boolean;
}) {
  return (
    <View
      role="radiogroup"
      aria-label={label}
      style={[styles.group, paired && styles.pair, stretch && styles.stretch]}
    >
      {cards.map((card) => {
        const checked = card.tier === selected;
        const disabled = card.unavailable !== undefined;
        return (
          <Pressable
            key={card.tier}
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={() => onSelect(card.tier)}
            style={({ pressed }) => [
              styles.card,
              paired && styles.pairedCard,
              stretch && styles.stretch,
              checked ? styles.checked : styles.unchecked,
              disabled && styles.disabled,
              pressed && !checked && !disabled && styles.pressed,
            ]}
          >
            <TierCardTop artwork={card.artwork} disabled={disabled}>
              <Text
                variant="title"
                style={[styles.name, disabled && styles.mutedInk]}
              >
                {card.name}
              </Text>
              <RadioMark checked={checked} disabled={disabled} />
            </TierCardTop>
            <View style={styles.panel}>
              {card.unavailable === undefined ? (
                <TierPrice card={card} locale={locale} />
              ) : (
                <Text variant="subhead" tone="warning">
                  {card.unavailable}
                </Text>
              )}
            </View>
            <Text variant="bodySmall" style={styles.description}>
              <Text style={styles.highlight}>{card.description}</Text>
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A tier card's artwork behind its head row (the name and the radio): the
 * art sits on the right, as tall as the card allows, centred top to bottom
 * and never cut off. Art that would cover the head starts below it, at
 * every font size.
 */
function TierCardTop({
  artwork: art,
  disabled = false,
  children,
}: {
  readonly artwork: ReturnType<typeof tierArtwork>;
  readonly disabled?: boolean;
  /** The head row's content: the name and the radio. */
  readonly children: ReactNode;
}) {
  const [headBottom, setHeadBottom] = useState<number | undefined>(undefined);
  return (
    <>
      {(!art.clearsTitle || headBottom !== undefined) && (
        <TierCardArtwork
          artwork={art}
          disabled={disabled}
          top={art.clearsTitle ? (headBottom ?? 0) + space.xs : 0}
        />
      )}
      <View
        style={styles.head}
        onLayout={({ nativeEvent: { layout } }) =>
          setHeadBottom(layout.y + layout.height)
        }
      >
        {children}
      </View>
    </>
  );
}

function TierCardArtwork({
  artwork: art,
  disabled,
  top,
}: {
  readonly artwork: ReturnType<typeof tierArtwork>;
  readonly disabled: boolean;
  readonly top: number;
}) {
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.artFrame, { top }]}
    >
      <Image
        aria-hidden
        source={art.source}
        resizeMode="contain"
        style={[
          styles.art,
          { aspectRatio: art.aspectRatio },
          disabled && styles.artDisabled,
        ]}
      />
    </View>
  );
}

function TierPrice({
  card,
  locale,
}: {
  readonly card: CoworkTierCard;
  readonly locale: AppLocale;
}) {
  return (
    <>
      {card.was !== undefined && (
        <Text variant="hint" tone="subtle" numeric style={styles.was}>
          {formatMoney(card.was, locale)}
        </Text>
      )}
      <Text style={styles.priceLine}>
        <Text variant="dialogTitle" tone="positive" numeric>
          {formatMoney(card.price, locale)}
        </Text>
        <Text variant="hint" tone="muted">
          {` ${m.booking_tier_price_per_day({}, { locale })}`}
        </Text>
      </Text>
    </>
  );
}

const highlight = "rgba(255,255,255,0.84)";

// The outline thickens from 1 to 2 when chosen; the padding gives back the
// difference so the content never shifts.
const outlined = (borderColor: string, borderWidth: 1 | 2) => ({
  borderColor,
  borderWidth,
  paddingTop: 14 - borderWidth,
  paddingHorizontal: space.lg - borderWidth,
  paddingBottom: space.lg - borderWidth,
});

const styles = StyleSheet.create({
  group: { gap: space.sm },
  pair: { flexDirection: "row" },
  pairedCard: { flex: 1, minWidth: 0 },
  stretch: { flexGrow: 1 },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.group,
    minHeight: 148,
    overflow: "hidden",
  },
  unchecked: outlined(color.line, 1),
  checked: { ...outlined(color.action, 2), backgroundColor: color.actionTint },
  disabled: { backgroundColor: color.disabledField },
  pressed: { backgroundColor: color.pressed },
  // The art fits inside the card's right 64% and is centred vertically.
  artFrame: {
    alignItems: "flex-end",
    bottom: 0,
    justifyContent: "center",
    left: "36%",
    position: "absolute",
    right: 0,
  },
  art: { height: "100%", maxWidth: "100%", width: undefined },
  artDisabled: { opacity: 0.5 },
  head: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.md,
    justifyContent: "space-between",
  },
  name: { flexShrink: 1, fontSize: 18, lineHeight: 24 },
  mutedInk: { color: color.ink2 },
  panel: {
    alignSelf: "flex-start",
    backgroundColor: highlight,
    borderRadius: radius.tile,
    marginLeft: -space.sm,
    marginTop: space.sm,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  was: { textDecorationLine: "line-through" },
  priceLine: { flexWrap: "wrap" },
  description: {
    color: color.ink2,
    lineHeight: 24,
    marginLeft: -6,
    marginTop: space.sm,
    maxWidth: "58%",
  },
  highlight: { backgroundColor: highlight },
});
