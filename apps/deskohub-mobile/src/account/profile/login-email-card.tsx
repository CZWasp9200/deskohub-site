import Check from "lucide-react-native/icons/check";
import Mail from "lucide-react-native/icons/mail";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Badge } from "../../ui/badge";
import { emailWithBreak } from "../../ui/email-with-break";
import { Icon } from "../../ui/icon";
import { ListGroup } from "../../ui/list";
import { listRowLayout } from "../../ui/list-row-layout";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";

/**
 * The account's login email, read-only: the address whole, a Verified badge
 * pinned top right, and the note that it can't be changed here. `compact`
 * draws it as onboarding's sunken line (board 06), without the note.
 */
export function LoginEmailCard({
  email,
  compact = false,
}: {
  readonly email: string;
  readonly compact?: boolean;
}) {
  const locale = useAppLocale();
  // At large font sizes the badge takes its own line, still top right, so
  // the address keeps the card's width (as `ListRow` moves its badge).
  const badgeAbove = useWindowDimensions().fontScale >= 1.3;
  const badge = (
    <Badge
      tone="positive"
      icon={Check}
      label={m.profile_email_verified_badge({}, { locale })}
    />
  );
  if (compact)
    return (
      <View accessible style={styles.line}>
        <Icon icon={Mail} size={18} color={color.ink2} />
        <View style={styles.lineText}>
          {badgeAbove && <View style={styles.lineBadgeAbove}>{badge}</View>}
          <View style={styles.titleLine}>
            <Text variant="bodySmall" tone="default" style={styles.address}>
              {emailWithBreak(email)}
            </Text>
            {!badgeAbove && badge}
          </View>
        </View>
      </View>
    );
  return (
    <ListGroup>
      <View accessible style={[listRowLayout.row, styles.row]}>
        <View style={listRowLayout.iconTile}>
          <Icon icon={Mail} size={20} />
        </View>
        <View style={[listRowLayout.text, styles.text]}>
          {/* The badge keeps the top right; the address wraps beside it. */}
          {badgeAbove && <View style={styles.badgeAbove}>{badge}</View>}
          <View style={styles.titleLine}>
            <Text variant="bodyStrong" style={styles.address}>
              {emailWithBreak(email)}
            </Text>
            {!badgeAbove && badge}
          </View>
          <Text variant="bodySmall">
            {m.profile_email_fixed({}, { locale })}
          </Text>
        </View>
      </View>
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-start" },
  text: { paddingTop: space.xxs },
  titleLine: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.sm,
    marginRight: -space.xs,
  },
  address: { flex: 1, minWidth: 0 },
  badgeAbove: { alignSelf: "flex-end", marginRight: -space.xs },
  line: {
    alignItems: "center",
    backgroundColor: color.sunken,
    borderRadius: radius.field,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  lineText: { flex: 1, gap: space.xs, minWidth: 0 },
  lineBadgeAbove: { alignSelf: "flex-end" },
});
