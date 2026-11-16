import type { CustomerOfferingFact } from "@deskohub/workspace-customer-api";
import Monitor from "lucide-react-native/icons/monitor";
import Users from "lucide-react-native/icons/users";
import { Image, StyleSheet, View } from "react-native";
import { Icon } from "../../ui/icon";
import { Text } from "../../ui/text";
import { color, radius, shadow, space } from "../../ui/tokens";
import { meetingRoomIllustration } from "../ui/meeting-room-illustration";

/** The picture box's height. */
const pictureHeight = 132;
/** The drawing is scaled to 140% of the box height (owner, 2026-11-15). */
const drawingHeight = pictureHeight * 1.4;
/**
 * About 8% of the box height comes off the drawing's bottom; the rest of
 * the overflow comes off its top.
 */
const drawingTop = pictureHeight * 1.08 - drawingHeight;

const factIcon = { capacity: Users, equipment: Monitor } as const;

/**
 * The meeting room's header: its illustration on the tint, cropped like the
 * board, and the room's key facts from the catalog under it.
 */
export function MeetingRoomHero({
  facts,
}: {
  readonly facts: ReadonlyArray<CustomerOfferingFact>;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.picture}>
        <Image
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          source={meetingRoomIllustration.source}
          resizeMode="contain"
          style={styles.drawing}
        />
      </View>
      {facts.length > 0 && (
        <View style={styles.facts}>
          {facts.map((fact) => (
            <View key={`${fact.kind}:${fact.text}`} style={styles.fact}>
              <Icon icon={factIcon[fact.kind]} size={16} color={color.ink2} />
              <Text variant="hint" tone="default" style={styles.factText}>
                {fact.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: "hidden",
    ...shadow.group,
  },
  picture: {
    alignItems: "center",
    backgroundColor: meetingRoomIllustration.background,
    height: pictureHeight,
    overflow: "hidden",
  },
  drawing: {
    aspectRatio: meetingRoomIllustration.aspectRatio,
    height: drawingHeight,
    position: "absolute",
    top: drawingTop,
  },
  facts: {
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingBottom: 14,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    rowGap: 6,
  },
  fact: {
    alignItems: "center",
    columnGap: 5,
    flexDirection: "row",
    flexShrink: 1,
  },
  factText: { flexShrink: 1 },
});
