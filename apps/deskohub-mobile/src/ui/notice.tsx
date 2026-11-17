import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Info from "lucide-react-native/icons/info";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { useLiveRegionAnnouncement } from "./live-announcement";
import {
  idleLiveRegionLayout,
  type NoticeTone,
  noticePresentation,
} from "./notice-presentation";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

export type { NoticeTone } from "./notice-presentation";

const noticeTones = {
  info: { background: color.infoTint, ink: color.navy, icon: Info },
  positive: {
    background: color.positiveTint,
    ink: color.positiveInk,
    icon: CircleCheck,
  },
  warning: {
    background: color.warningTint,
    ink: color.warningInk,
    icon: TriangleAlert,
  },
  error: {
    background: color.dangerTint,
    ink: color.dangerInk,
    icon: CircleAlert,
  },
} as const satisfies Record<
  NoticeTone,
  {
    readonly background: string;
    readonly ink: string;
    readonly icon: IconComponent;
  }
>;

/**
 * A message about the screen's state, such as an account gate or a failed
 * save: a box tinted by its tone with the tone's icon (or `icon`), an
 * optional `title` above the message and an optional `action` under it. It
 * stays mounted as a live region, so assistive tech announces each change,
 * and draws its box only while there is a message; while idle it sits out
 * of the layout flow and takes no space.
 */
export function Notice({
  tone,
  message,
  title,
  action,
  icon,
}: {
  readonly tone: NoticeTone;
  readonly message: string | undefined;
  readonly title?: string;
  /** A text button under the message, such as "Try again". */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** A Lucide icon in place of the tone's own. */
  readonly icon?: IconComponent;
}) {
  const { shown, role, live, announcement } = noticePresentation(
    tone,
    message,
    title
  );
  useLiveRegionAnnouncement(announcement, live);
  const { background, ink, icon: toneIcon } = noticeTones[tone];
  return (
    <View
      style={
        shown
          ? [styles.box, { backgroundColor: background }]
          : idleLiveRegionLayout
      }
    >
      {shown && <Icon icon={icon ?? toneIcon} size={20} color={ink} />}
      <View style={styles.body}>
        <Text
          role={role}
          aria-live={live}
          // Text doesn't map `aria-live` to Android's live region; View does.
          accessibilityLiveRegion={live}
          variant="bodySmall"
          style={{ color: ink }}
        >
          {shown && title !== undefined && (
            <Text variant="subhead" style={{ color: ink }}>
              {`${title}\n`}
            </Text>
          )}
          {message ?? ""}
        </Text>
        {shown && action !== undefined && (
          <Pressable
            role="button"
            onPress={action.onPress}
            // The label is drawn 20 tall; its target is 48.
            hitSlop={{ top: 14, bottom: 14, left: space.sm, right: space.sm }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text variant="label" tone="action">
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "flex-start",
    borderRadius: radius.field,
    flexDirection: "row",
    gap: space.md,
    paddingHorizontal: 14,
    paddingVertical: space.md,
  },
  body: { flex: 1, minWidth: 0 },
  action: { alignSelf: "flex-start", marginTop: 6 },
  pressed: { opacity: 0.7 },
});
