import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppLocale } from "../i18n/locale-context";
import { Text } from "../ui/text";
import { useFloatingBottomOffset } from "../ui/toast";
import { color, radius, space, typeScale } from "../ui/tokens";
import { useUpdateOffer } from "./update-offer";
import { updateOfferCopy } from "./update-offer-copy";

/**
 * The prominent update offer, laid over the bottom of every screen outside
 * the critical flows without blocking it. It sits where toasts do, above the
 * tab bar and any bottom chrome a focused layout registers, and stays away
 * while a focused screen shows the offer in its own content. The live region
 * stays mounted so screen readers announce a prompt when it appears.
 */
export function UpdateBanner() {
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const bottom = useFloatingBottomOffset();
  const { prompt, accept, dismiss, hostedByScreen } = useUpdateOffer();

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.overlay,
        {
          paddingBottom: bottom,
          paddingLeft: insets.left + space.lg,
          paddingRight: insets.right + space.lg,
        },
      ]}
    >
      {prompt && !hostedByScreen && (
        <UpdateBannerCard
          {...updateOfferCopy(prompt, locale)}
          onAccept={accept}
          onDismiss={dismiss}
        />
      )}
    </View>
  );
}

/** The banner's navy card: the message over its dismiss and accept buttons. */
export function UpdateBannerCard({
  message,
  acceptLabel,
  dismissLabel,
  onAccept,
  onDismiss,
}: {
  readonly message: string;
  readonly acceptLabel: string;
  readonly dismissLabel: string;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.action}
        >
          <Text style={styles.dismissLabel}>{dismissLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onAccept}
          style={[styles.action, styles.acceptAction]}
        >
          <Text style={styles.acceptLabel}>{acceptLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    pointerEvents: "box-none",
    position: "absolute",
    right: 0,
  },
  card: {
    backgroundColor: color.navy,
    borderRadius: radius.field,
    gap: space.sm,
    padding: space.lg,
  },
  message: { color: color.paper, ...typeScale.body },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "flex-end",
  },
  action: {
    borderRadius: radius.field,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: space.lg,
  },
  acceptAction: { backgroundColor: color.action },
  dismissLabel: { color: color.paper, ...typeScale.body },
  acceptLabel: { color: color.paper, ...typeScale.bodyStrong },
});
