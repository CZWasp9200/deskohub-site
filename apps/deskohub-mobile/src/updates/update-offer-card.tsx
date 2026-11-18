import Download from "lucide-react-native/icons/download";
import X from "lucide-react-native/icons/x";
import { useState } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { Icon } from "../ui/icon";
import { IconButton } from "../ui/icon-button";
import { idleLiveRegionLayout } from "../ui/notice-presentation";
import { Text } from "../ui/text";
import {
  color,
  radius,
  shadow,
  space,
  touchTarget,
  typeScale,
} from "../ui/tokens";
import { useUpdateOffer, useUpdateOfferHost } from "./update-offer";
import { type UpdateOfferCopy, updateOfferCopy } from "./update-offer-copy";
import {
  updateOfferActionPlacement,
  updateOfferMetrics,
} from "./update-offer-layout";
import type { UpdatePrompt } from "./update-prompt";

/** What the quiet card sits on: the navy sign-in masthead or the paper canvas. */
export type UpdateOfferBackdrop = "navy" | "paper";

/**
 * The quiet update offer on a critical flow (sign-in, onboarding, booking):
 * the first item of the screen's content, scrolling with it. While its
 * screen is focused the bottom banner stays away, and it shows the same
 * offer the banner would. It stays mounted as a live region, so screen
 * readers announce an offer when it appears; while there is none it sits
 * out of the layout flow and takes no space. `style` places the card and
 * applies only while it shows.
 */
export function QuietUpdateOffer({
  backdrop,
  style,
}: {
  readonly backdrop: UpdateOfferBackdrop;
  readonly style?: StyleProp<ViewStyle>;
}) {
  useUpdateOfferHost();
  const { prompt, accept, dismiss } = useUpdateOffer();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={prompt ? style : idleLiveRegionLayout}
    >
      {prompt && (
        <OfferedUpdateCard
          prompt={prompt}
          backdrop={backdrop}
          onAccept={accept}
          onDismiss={dismiss}
        />
      )}
    </View>
  );
}

/** The card for `prompt`, worded in the app's language. */
function OfferedUpdateCard({
  prompt,
  ...card
}: {
  readonly prompt: UpdatePrompt;
  readonly backdrop: UpdateOfferBackdrop;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}) {
  const locale = useAppLocale();
  return <UpdateOfferCard {...updateOfferCopy(prompt, locale)} {...card} />;
}

// The message's first line, at the current font scale, centres the icon and
// the dismiss glyph on it.
const firstLineHeight = typeScale.bodySmall.lineHeight;
// The action's label is drawn one line tall; its target is 48.
const actionSlop = (touchTarget - typeScale.label.lineHeight) / 2;

/**
 * The quiet update card, drawn as the app's notice on a light card: a
 * download icon, the message, the accept action and a dismiss button whose
 * screen-reader name is the dismiss label. The action sits to the right of
 * the message when the message keeps about two lines of room beside it
 * (`updateOfferActionPlacement`), else under it.
 */
export function UpdateOfferCard({
  message,
  acceptLabel,
  dismissLabel,
  backdrop,
  onAccept,
  onDismiss,
}: UpdateOfferCopy & {
  readonly backdrop: UpdateOfferBackdrop;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const [cardWidth, setCardWidth] = useState<number>();
  const [actionLabelWidth, setActionLabelWidth] = useState<number>();
  const inline =
    cardWidth !== undefined &&
    actionLabelWidth !== undefined &&
    updateOfferActionPlacement({ cardWidth, actionLabelWidth, fontScale }) ===
      "inline";
  // Centres a 20 dp glyph on the message's first line.
  const firstLineInset = ((firstLineHeight - 20) * fontScale) / 2;
  const action = (
    <Pressable
      role="button"
      onPress={onAccept}
      hitSlop={{
        top: actionSlop,
        bottom: actionSlop,
        left: updateOfferMetrics.actionInset,
        right: updateOfferMetrics.actionInset,
      }}
      style={({ pressed }) => [
        inline ? styles.inlineAction : styles.stackedAction,
        pressed && styles.pressed,
      ]}
    >
      <Text
        variant="label"
        tone="action"
        onLayout={({ nativeEvent }) =>
          setActionLabelWidth(nativeEvent.layout.width)
        }
      >
        {acceptLabel}
      </Text>
    </Pressable>
  );
  return (
    <View
      onLayout={({ nativeEvent }) => setCardWidth(nativeEvent.layout.width)}
      style={[
        styles.card,
        inline ? styles.inlineCard : styles.stackedCard,
        backdrop === "navy" ? shadow.onNavy : styles.outlined,
      ]}
    >
      <View style={!inline && { paddingTop: firstLineInset }}>
        <Icon icon={Download} size={20} color={color.navy} />
      </View>
      <View style={[styles.body, inline && styles.inlineBody]}>
        <Text
          variant="bodySmall"
          tone="default"
          style={inline && styles.inlineMessage}
        >
          {message}
        </Text>
        {!inline && action}
      </View>
      {inline && action}
      <View
        style={
          !inline && {
            marginTop: -space.md + firstLineInset,
          }
        }
      >
        <IconButton icon={X} label={dismissLabel} onPress={onDismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.group,
    flexDirection: "row",
    gap: updateOfferMetrics.gap,
    paddingLeft: updateOfferMetrics.paddingStart,
  },
  stackedCard: {
    alignItems: "flex-start",
    paddingBottom: actionSlop + space.xs,
    paddingTop: space.md,
  },
  inlineCard: {
    alignItems: "center",
    paddingVertical: space.xs,
  },
  outlined: {
    borderColor: color.line,
    borderWidth: 1,
    ...shadow.group,
  },
  body: { flex: 1, minWidth: 0 },
  inlineBody: { justifyContent: "center" },
  inlineMessage: { paddingVertical: space.sm },
  stackedAction: { alignSelf: "flex-start", marginTop: 6 },
  inlineAction: { marginLeft: updateOfferMetrics.actionInset },
  pressed: { opacity: 0.7 },
});
