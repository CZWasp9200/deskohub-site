import type { CustomerOfferingFact } from "@deskohub/workspace-customer-api";
import Monitor from "lucide-react-native/icons/monitor";
import Users from "lucide-react-native/icons/users";
import { StyleSheet, View } from "react-native";
import { Icon } from "../../ui/icon";
import { Text } from "../../ui/text";
import { color, radius, shadow, space } from "../../ui/tokens";
import { SpaceIllustration } from "../ui/space-illustration";

/** The picture box's height. */
const pictureHeight = 132;

const factIcon = { capacity: Users, equipment: Monitor } as const;

/**
 * The meeting room's header: its illustration on the tint, cropped like the
 * board, and the room's key facts from the catalog under it.
 */
export function MeetingRoomHero({
  facts,
  inline = false,
}: {
  readonly facts: ReadonlyArray<CustomerOfferingFact>;
  readonly inline?: boolean;
}) {
  return (
    <View style={!inline && styles.card}>
      {!inline && (
        <SpaceIllustration
          family="meeting-room"
          height={pictureHeight}
          span="full"
        />
      )}
      {facts.length > 0 && (
        <View style={[styles.facts, inline && styles.inlineFacts]}>
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
  facts: {
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingBottom: 14,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    rowGap: 6,
  },
  inlineFacts: {
    justifyContent: "flex-end",
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: space.sm,
  },
  fact: {
    alignItems: "center",
    columnGap: 5,
    flexDirection: "row",
    flexShrink: 1,
  },
  factText: { flexShrink: 1 },
});
