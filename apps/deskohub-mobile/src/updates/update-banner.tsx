import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAnalyticsConsent } from "../consent/use-analytics-consent";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Text } from "../ui/text";
import { color, radius, space, typeScale } from "../ui/tokens";
import { updatePromptWaitsForConsent } from "./update-prompt";
import { useUpdatePrompt } from "./use-update-prompt";

/**
 * The update offer, laid over the bottom of every screen without blocking
 * it. The live region stays mounted so screen readers announce a prompt
 * when it appears. It stays empty while the analytics consent prompt, which
 * sits in the same place, waits for an answer.
 */
export function UpdateBanner() {
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const { prompt: offered, accept, dismiss } = useUpdatePrompt();
  const consent = useAnalyticsConsent();
  const prompt = updatePromptWaitsForConsent(consent.status)
    ? undefined
    : offered;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.overlay,
        {
          paddingBottom: insets.bottom + space.lg,
          paddingLeft: insets.left + space.lg,
          paddingRight: insets.right + space.lg,
        },
      ]}
    >
      {prompt?.kind === "native-release" && (
        <UpdateBannerCard
          acceptLabel={m.native_update_download({}, { locale })}
          dismissLabel={m.update_prompt_dismiss({}, { locale })}
          message={m.native_update_available(
            { versionName: prompt.versionName },
            { locale }
          )}
          onAccept={accept}
          onDismiss={dismiss}
        />
      )}
      {(prompt?.kind === "ota-update" || prompt?.kind === "roll-back") && (
        <UpdateBannerCard
          acceptLabel={m.update_ready_restart({}, { locale })}
          dismissLabel={m.update_prompt_dismiss({}, { locale })}
          message={m.update_ready({}, { locale })}
          onAccept={accept}
          onDismiss={dismiss}
        />
      )}
    </View>
  );
}

function UpdateBannerCard({
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
