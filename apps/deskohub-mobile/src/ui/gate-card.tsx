import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Card } from "./card";
import { discColors, type EmptyStateTone } from "./empty-state";
import { Icon, type IconComponent } from "./icon";
import { Text } from "./text";
import { radius, space } from "./tokens";

/**
 * Why a tab can't show its content yet, in place of that content: a card
 * with an icon disc, a title, one line of `body`, and the one next step as
 * `children`, all aligned to the start. On a tab root it overlaps the
 * masthead like the content it replaces.
 */
export function GateCard({
  icon,
  tone = "neutral",
  title,
  body,
  children,
}: {
  readonly icon: IconComponent;
  readonly tone?: EmptyStateTone;
  readonly title: string;
  readonly body: string;
  /** The actions, such as one full-width button. */
  readonly children?: ReactNode;
}) {
  const disc = discColors[tone];
  return (
    <Card padding="none">
      <View style={styles.content}>
        <View style={[styles.disc, { backgroundColor: disc.background }]}>
          <Icon icon={icon} size={28} color={disc.ink} />
        </View>
        <Text variant="title" role="heading">
          {title}
        </Text>
        <Text variant="lead" tone="muted">
          {body}
        </Text>
        {children !== undefined && (
          <View style={styles.actions}>{children}</View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
  },
  disc: {
    alignItems: "center",
    borderRadius: radius.disc,
    height: 64,
    justifyContent: "center",
    marginBottom: space.xs,
    width: 64,
  },
  actions: { gap: space.sm, marginTop: space.sm },
});
