import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { Skeleton, SkeletonGroup } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { brandText, color, radius, shadow, space } from "../../ui/tokens";
import { SpaceIllustration } from "../ui/space-illustration";
import { familyTitle } from "./booking-family-copy";
import {
  pairFits,
  type SpaceCard,
  type SpaceFacts,
  type SpaceRow,
  type SpaceUnit,
  spaceRows,
} from "./space-chooser";

/** The board's picture heights: a half-width and a full-width card. */
const pictureHeight = { half: 104, full: 148 } as const;
/** A half card's text inset on each side. */
const halfPadding = 10;
/** The widest the screen's content column grows (`ScrollScreen`). */
const contentMaxWidth = 640;

/** Whether the office and the meeting room fit side by side here. */
const usePairFits = () => {
  const { width, fontScale } = useWindowDimensions();
  return pairFits({
    contentWidth: Math.min(width - 2 * space.gutter, contentMaxWidth),
    fontScale,
    gap: space.md,
    padding: halfPadding,
  });
};

const spaceName = (card: SpaceCard, locale: AppLocale) =>
  Option.getOrElse(card.name, () => familyTitle(card.family, locale));

const factsText = (facts: SpaceFacts, locale: AppLocale) => {
  switch (facts.kind) {
    case "catalog":
      return facts.text;
    case "office-seats":
      return m.booking_space_office_seats({ count: facts.maximum }, { locale });
    case "always-open":
      return m.booking_space_always_open({}, { locale });
  }
};

const unitText = (unit: SpaceUnit, locale: AppLocale) => {
  switch (unit.kind) {
    case "day":
      return m.booking_tier_price_per_day({}, { locale });
    case "hour":
      return m.booking_space_per_hour({}, { locale });
    case "length":
      return m.booking_space_per_length({ length: unit.label }, { locale });
  }
};

/** The unit in words, for assistive tech, which reads no "/". */
const unitWords = (unit: SpaceUnit, locale: AppLocale) => {
  switch (unit.kind) {
    case "day":
      return m.booking_price_unit_per_day({}, { locale });
    case "hour":
      return m.booking_price_unit_per_hour({}, { locale });
    case "length":
      return unit.label;
  }
};

/** The card read as one link: name, price with its unit, then the facts. */
const cardLabel = (card: SpaceCard, locale: AppLocale) =>
  [
    spaceName(card, locale),
    `${m.booking_family_from_price(
      { price: formatMoney(card.fromPrice, locale) },
      { locale }
    )} ${unitWords(card.unit, locale)}`,
    factsText(card.facts, locale),
  ].join(", ");

/**
 * The spaces to book as picture cards, office and meeting room side by side
 * when both are offered and fit, every other card full width. A card opens
 * its space's booking.
 */
export function SpaceCards({
  cards,
  locale,
  onOpen,
}: {
  readonly cards: ReadonlyArray<SpaceCard>;
  readonly locale: AppLocale;
  readonly onOpen: (family: CustomerReservationFamily) => void;
}) {
  const rows = spaceRows(cards, usePairFits());
  return (
    <View style={styles.cards}>
      {rows.map((row) => (
        <SpaceCardRow
          key={row.map(({ family }) => family).join(":")}
          row={row}
          locale={locale}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

function SpaceCardRow({
  row,
  locale,
  onOpen,
}: {
  readonly row: SpaceRow;
  readonly locale: AppLocale;
  readonly onOpen: (family: CustomerReservationFamily) => void;
}) {
  if (row.length === 1) {
    return <FullCard card={row[0]} locale={locale} onOpen={onOpen} />;
  }
  return (
    <View style={styles.pair}>
      {row.map((card) => (
        <HalfCard
          key={card.family}
          card={card}
          locale={locale}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

function CardShell({
  card,
  locale,
  onOpen,
  half,
  children,
}: {
  readonly card: SpaceCard;
  readonly locale: AppLocale;
  readonly onOpen: (family: CustomerReservationFamily) => void;
  readonly half: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      // It opens the space's booking, as a list row that navigates does.
      role="link"
      accessibilityLabel={cardLabel(card, locale)}
      onPress={() => onOpen(card.family)}
      style={({ pressed }) => [
        styles.card,
        half && styles.half,
        pressed && styles.pressed,
      ]}
    >
      <SpaceIllustration
        family={card.family}
        height={half ? pictureHeight.half : pictureHeight.full}
        span={half ? "half" : "full"}
      />
      {children}
    </Pressable>
  );
}

function HalfCard({
  card,
  locale,
  onOpen,
}: {
  readonly card: SpaceCard;
  readonly locale: AppLocale;
  readonly onOpen: (family: CustomerReservationFamily) => void;
}) {
  return (
    <CardShell card={card} locale={locale} onOpen={onOpen} half>
      <View style={styles.halfText}>
        <Text variant="bodyStrong">{spaceName(card, locale)}</Text>
        <FromPrice card={card} locale={locale} size="half" />
        <Text variant="hint">{factsText(card.facts, locale)}</Text>
      </View>
    </CardShell>
  );
}

function FullCard({
  card,
  locale,
  onOpen,
}: {
  readonly card: SpaceCard;
  readonly locale: AppLocale;
  readonly onOpen: (family: CustomerReservationFamily) => void;
}) {
  return (
    <CardShell card={card} locale={locale} onOpen={onOpen} half={false}>
      <View style={styles.fullText}>
        <View style={styles.fullName}>
          <Text tone="default" style={styles.fullTitle}>
            {spaceName(card, locale)}
          </Text>
          <Text variant="hint">{factsText(card.facts, locale)}</Text>
        </View>
        <FromPrice card={card} locale={locale} size="full" />
      </View>
    </CardShell>
  );
}

/** The price with its unit on one line, a small "from" above. */
function FromPrice({
  card,
  locale,
  size,
}: {
  readonly card: SpaceCard;
  readonly locale: AppLocale;
  readonly size: "half" | "full";
}) {
  return (
    <View style={styles.price}>
      <Text variant="hint" style={styles.from}>
        {m.booking_space_from({}, { locale })}
      </Text>
      <View style={styles.amountLine}>
        <Text
          tone="default"
          numeric
          style={size === "half" ? styles.amountHalf : styles.amountFull}
        >
          {formatMoney(card.fromPrice, locale)}
        </Text>
        <Text
          variant="hint"
          style={size === "half" ? styles.unitHalf : styles.unitFull}
        >
          {unitText(card.unit, locale)}
        </Text>
      </View>
    </View>
  );
}

/**
 * The cards still loading, in their final layout: the office and meeting
 * room side by side, the cowork desk full width under them.
 */
export function SpaceCardsSkeleton({ label }: { readonly label: string }) {
  const fits = usePairFits();
  return (
    <SkeletonGroup label={label}>
      <View style={styles.cards}>
        {fits ? (
          <View style={styles.pair}>
            <HalfSkeleton />
            <HalfSkeleton />
          </View>
        ) : (
          <>
            <FullSkeleton />
            <FullSkeleton />
          </>
        )}
        <FullSkeleton />
      </View>
    </SkeletonGroup>
  );
}

function HalfSkeleton() {
  return (
    <View style={[styles.card, styles.half]}>
      <Skeleton width="100%" height={pictureHeight.half} radius={0} />
      <View style={styles.halfSkeletonText}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="55%" height={12} />
        <Skeleton width="80%" height={12} />
      </View>
    </View>
  );
}

function FullSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton width="100%" height={pictureHeight.full} radius={0} />
      <View style={styles.fullSkeletonText}>
        <Skeleton width="45%" height={18} />
        <Skeleton width="70%" height={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The board keeps the first card's top edge clear of the masthead's edge.
  cards: { gap: space.md, paddingTop: space.xs },
  pair: { alignItems: "stretch", flexDirection: "row", gap: space.md },
  card: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: "hidden",
    ...shadow.group,
  },
  half: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: color.pressed },
  halfText: {
    gap: space.xxs,
    paddingBottom: 14,
    paddingHorizontal: halfPadding,
    paddingTop: space.md,
  },
  fullText: {
    alignItems: "center",
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingBottom: 14,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    rowGap: space.xs,
  },
  // The name keeps at least 40% of the row; a price that no longer fits
  // beside it, with long names or large text, moves under it.
  fullName: { flexGrow: 1, flexShrink: 1, gap: space.xxs, minWidth: "40%" },
  // Off the type scale, as the board sizes it: between headline and title.
  fullTitle: brandText(18, 24, 600),
  price: { alignItems: "flex-start" },
  from: { fontSize: 10, lineHeight: 11, marginBottom: -2 },
  amountLine: {
    alignItems: "baseline",
    columnGap: 3,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  amountHalf: brandText(16, 22, 700),
  amountFull: brandText(18, 22, 700),
  unitHalf: { fontSize: 11, lineHeight: 16 },
  unitFull: { fontSize: 12, lineHeight: 16 },
  halfSkeletonText: { gap: 10, padding: space.md },
  fullSkeletonText: {
    gap: 10,
    paddingBottom: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
});
