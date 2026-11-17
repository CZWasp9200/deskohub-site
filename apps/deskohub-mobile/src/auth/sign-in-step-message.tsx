import { brandFontVariation } from "@deskohub/brand-tokens";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { StyleSheet, View } from "react-native";
import { Icon } from "../ui/icon";
import { useLiveRegionAnnouncement } from "../ui/live-announcement";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";

/** What a sign-in step says under its field, and how. */
export interface SignInStepNotice {
  readonly tone: "error" | "positive";
  readonly text: string;
}

/**
 * The line under a sign-in step's field: an error, or a confirmation such as
 * a new code sent. Both live regions stay mounted so each new message is
 * announced; only the current one shows.
 */
export function SignInStepMessage({
  id,
  notice,
}: {
  /** Lets the field name this message as its description. */
  readonly id?: string;
  readonly notice: SignInStepNotice | undefined;
}) {
  const error = notice?.tone === "error" ? notice.text : undefined;
  const confirmation = notice?.tone === "positive" ? notice.text : undefined;
  useLiveRegionAnnouncement(error, "assertive");
  useLiveRegionAnnouncement(confirmation, "polite");
  return (
    <View nativeID={id}>
      <View style={notice ? styles.line : styles.idle}>
        {notice && (
          <View style={styles.icon}>
            <Icon
              icon={notice.tone === "error" ? CircleAlert : CircleCheck}
              size={16}
              color={
                notice.tone === "error" ? color.dangerInk : color.positiveInk
              }
            />
          </View>
        )}
        <Text
          role="alert"
          aria-live="assertive"
          accessibilityLiveRegion="assertive"
          variant="hint"
          tone="danger"
          style={styles.text}
        >
          {error ?? ""}
        </Text>
        <Text
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite"
          variant="hint"
          tone="positive"
          style={styles.text}
        >
          {confirmation ?? ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 6,
    marginTop: space.sm,
  },
  idle: { height: 0, overflow: "hidden" },
  // Long messages wrap beside the icon instead of shrinking it.
  icon: { flexShrink: 0, marginTop: 1 },
  // The message weight of the boards' field messages.
  text: {
    flexShrink: 1,
    fontVariationSettings: brandFontVariation(500),
    fontWeight: "500",
  },
});
