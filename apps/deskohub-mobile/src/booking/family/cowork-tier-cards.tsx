import type {
  CustomerBookableCoworkTier,
  Money,
} from "@deskohub/workspace-customer-api";
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

/** The website's desk artwork, cropped to the part a card shows. */
const artwork = {
  openSpace: {
    source: require("../../../assets/images/booking/open-space.webp"),
    aspectRatio: 630 / 482,
  },
  reservedDesk: {
    source: require("../../../assets/images/booking/reserved-desk.webp"),
    aspectRatio: 630 / 477,
  },
  reservedDeskWorkstation: {
    source: require("../../../assets/images/booking/reserved-desk-workstation.webp"),
    aspectRatio: 630 / 459,
  },
} satisfies Record<
  string,
  { readonly source: ImageSourcePropType; readonly aspectRatio: number }
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
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly cards: ReadonlyArray<CoworkTierCard>;
  readonly selected: CustomerBookableCoworkTier;
  readonly onSelect: (tier: CustomerBookableCoworkTier) => void;
  readonly locale: AppLocale;
}) {
  return (
    <View role="radiogroup" aria-label={label} style={styles.group}>
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
              checked ? styles.checked : styles.unchecked,
              disabled && styles.disabled,
              pressed && !checked && !disabled && styles.pressed,
            ]}
          >
            <Image
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              source={card.artwork.source}
              resizeMode="contain"
              style={[
                styles.art,
                { aspectRatio: card.artwork.aspectRatio },
                disabled && styles.artDisabled,
              ]}
            />
            <View style={styles.head}>
              <Text
                variant="title"
                style={[styles.name, disabled && styles.mutedInk]}
              >
                {card.name}
              </Text>
              <RadioMark checked={checked} disabled={disabled} />
            </View>
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
  // The board places the art 28 past the right edge and 30 down, 64% wide.
  art: {
    height: undefined,
    position: "absolute",
    right: -28,
    top: 30,
    width: "64%",
  },
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
