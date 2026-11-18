import { brandFontVariation } from "@deskohub/brand-tokens";
import type {
  CustomerMeetingRoomDuration,
  Money,
} from "@deskohub/workspace-customer-api";
import { type ComponentRef, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { formatMoney } from "../../i18n/money-format";
import { choiceIndexForKey, tabStopIndex } from "../../ui/choice-group-keys";
import { RadioMark } from "../../ui/radio-card";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";

/** One meeting-room length as the list shows it. */
export interface MeetingRoomLength {
  readonly duration: CustomerMeetingRoomDuration;
  /** The catalog's name for the length. */
  readonly label: string;
  /** Today's advertised price for one booking of the length. */
  readonly price: Money;
  /** The regular price, struck above it, while a sale lowers it. */
  readonly was?: Money;
}

/**
 * The meeting-room lengths as one list card (board 28): a radio, the length
 * and its price on the right with the regular price struck above it. A row
 * whose name and price don't fit side by side, with long text or a large
 * font, moves the price under the name instead of cutting either. Reads as a
 * radio group; with a keyboard it is one tab stop and the arrows choose.
 */
export function MeetingRoomLengths({
  label,
  lengths,
  selected,
  onSelect,
  locale,
  cards = false,
}: {
  /** Names the group for assistive tech. */
  readonly label: string;
  readonly lengths: ReadonlyArray<MeetingRoomLength>;
  /** None until the customer chooses a length. */
  readonly selected: CustomerMeetingRoomDuration | undefined;
  readonly onSelect: (duration: CustomerMeetingRoomDuration) => void;
  readonly locale: AppLocale;
  readonly cards?: boolean;
}) {
  const rowRefs = useRef<Array<ComponentRef<typeof Pressable> | null>>([]);
  const tabStop = tabStopIndex(
    lengths.map(({ duration }) => duration),
    selected
  );
  const choose = (index: number) => {
    const length = lengths[index];
    if (length !== undefined && length.duration !== selected) {
      onSelect(length.duration);
    }
  };
  return (
    <View
      role="radiogroup"
      aria-label={label}
      style={cards ? styles.cards : styles.list}
    >
      {lengths.map((length, index) => {
        const checked = length.duration === selected;
        return (
          <Pressable
            key={length.duration}
            ref={(node) => {
              rowRefs.current[index] = node;
            }}
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStop ? 0 : -1}
            onPress={() => choose(index)}
            onKeyDown={(event) => {
              const next = choiceIndexForKey(
                event.nativeEvent.key,
                index,
                lengths.length
              );
              if (next === undefined) return;
              event.preventDefault();
              rowRefs.current[next]?.focus();
              choose(next);
            }}
            style={({ pressed }) => [
              styles.row,
              cards ? styles.card : index > 0 && styles.divided,
              checked && styles.checked,
              cards && checked && styles.checkedCard,
              pressed && !checked && styles.pressed,
            ]}
          >
            <View style={cards && styles.cardRadio}>
              <RadioMark checked={checked} disabled={false} />
            </View>
            <View style={[styles.content, cards && styles.cardContent]}>
              <Text variant="bodyStrong" style={styles.name}>
                {length.label}
              </Text>
              <View style={cards ? styles.cardPrice : styles.price}>
                {length.was !== undefined && (
                  <Text
                    variant="caption"
                    tone="subtle"
                    numeric
                    style={styles.was}
                  >
                    {formatMoney(length.was, locale)}
                  </Text>
                )}
                <Text
                  variant={cards ? "title" : "bodyStrong"}
                  tone={length.was === undefined ? "default" : "positive"}
                  numeric
                  style={styles.amount}
                >
                  {formatMoney(length.price, locale)}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexGrow: 1, gap: space.sm },
  list: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    alignItems: "center",
    columnGap: space.md,
    flexDirection: "row",
    minHeight: 60,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  divided: { borderTopColor: color.divider, borderTopWidth: 1 },
  checked: { backgroundColor: color.actionTint },
  card: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 2,
    flexGrow: 1,
    minHeight: 120,
    paddingVertical: space.lg,
    position: "relative",
  },
  checkedCard: { borderColor: color.action },
  cardRadio: { position: "absolute", right: space.lg, top: space.lg },
  cardContent: {
    alignItems: "stretch",
    alignSelf: "stretch",
    flexDirection: "column",
    flexWrap: "nowrap",
    gap: space.md,
    paddingRight: 28,
  },
  cardPrice: { alignItems: "flex-start" },
  pressed: { backgroundColor: color.pressed },
  content: {
    alignItems: "center",
    columnGap: space.md,
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: space.xxs,
  },
  name: { flexShrink: 1 },
  price: { alignItems: "flex-end", marginLeft: "auto" },
  was: {
    fontVariationSettings: brandFontVariation(400),
    fontWeight: "400",
    textDecorationLine: "line-through",
  },
  amount: {
    fontVariationSettings: brandFontVariation(700),
    fontWeight: "700",
  },
});
