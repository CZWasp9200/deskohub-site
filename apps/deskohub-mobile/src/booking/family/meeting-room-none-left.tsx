import { StyleSheet, View } from "react-native";
import { Button } from "../../ui/controls";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";

/**
 * In place of the start times when the chosen length has nothing free that
 * day (board 28b): what is full, what is still free, and a button for each
 * suggestion.
 */
export function MeetingRoomNoneLeft({
  title,
  body,
  actions,
}: {
  readonly title: string;
  readonly body: string;
  readonly actions: ReadonlyArray<{
    readonly label: string;
    readonly onPress: () => void;
  }>;
}) {
  return (
    <View style={styles.box}>
      <Text variant="bodyStrong" role="heading">
        {title}
      </Text>
      <Text variant="bodySmall">{body}</Text>
      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              onPress={action.onPress}
              variant="secondary"
              size="small"
              width="content"
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "flex-start",
    borderColor: color.dashed,
    borderRadius: radius.group,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    rowGap: space.md,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
