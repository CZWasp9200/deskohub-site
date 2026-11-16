import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

/** The colour of an empty state's icon disc. */
export type EmptyStateTone =
  | "neutral"
  | "positive"
  | "danger"
  | "action"
  | "navy";

/** An icon disc's fill and icon colour per tone, shared with gate cards. */
export const discColors = {
  neutral: { background: color.sunken, ink: color.navy },
  positive: { background: color.positiveTint, ink: color.positiveInk },
  danger: { background: color.dangerTint, ink: color.dangerInk },
  action: { background: color.actionTint, ink: color.action },
  navy: { background: color.navy, ink: color.white },
} as const satisfies Record<
  EmptyStateTone,
  { readonly background: string; readonly ink: string }
>;

/**
 * What a place shows when it has nothing yet, or couldn't load: an icon
 * disc, a title, an optional line of `body` and the one next action as
 * `children`, all centred. It fills the card it replaces; `dashed` draws its
 * own outline instead, for an empty slot on the canvas.
 *
 * `live` makes the title a live region, as for a load error: it stays
 * mounted and announces each new title, `assertive` as an alert.
 */
export function EmptyState({
  icon,
  title,
  body,
  tone = "neutral",
  dashed = false,
  live,
  children,
}: {
  readonly icon: IconComponent;
  readonly title: string;
  readonly body?: string;
  readonly tone?: EmptyStateTone;
  readonly dashed?: boolean;
  readonly live?: "polite" | "assertive";
  /** The actions, such as one full-width button. */
  readonly children?: ReactNode;
}) {
  const disc = discColors[tone];
  // A live title is read with the line under it, such as a failure's cause.
  const announced =
    title !== "" && body !== undefined ? `${title}. ${body}` : title;
  useLiveRegionAnnouncement(live && announced, live ?? "polite");
  return (
    <View style={[styles.empty, dashed && styles.dashed]}>
      <View style={[styles.disc, { backgroundColor: disc.background }]}>
        <Icon icon={icon} size={28} color={disc.ink} />
      </View>
      <Text
        variant="title"
        role={live && (live === "assertive" ? "alert" : "status")}
        aria-live={live}
        // Text doesn't map `aria-live` to Android's live region; View does.
        accessibilityLiveRegion={live}
        accessibilityLabel={
          live !== undefined && announced !== title ? announced : undefined
        }
        style={styles.centred}
      >
        {title}
      </Text>
      {body !== undefined && (
        <Text variant="bodySmall" style={[styles.centred, styles.body]}>
          {body}
        </Text>
      )}
      {children !== undefined && <View style={styles.actions}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: 28,
  },
  dashed: {
    borderColor: color.dashed,
    borderRadius: radius.group,
    borderWidth: 1.5,
  },
  disc: {
    alignItems: "center",
    borderRadius: radius.disc,
    height: 64,
    justifyContent: "center",
    marginBottom: space.sm,
    width: 64,
  },
  centred: { textAlign: "center" },
  body: { maxWidth: 280 },
  actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.sm },
});
