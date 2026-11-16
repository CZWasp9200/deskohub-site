import Check from "lucide-react-native/icons/check";
import Mail from "lucide-react-native/icons/mail";
import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Badge } from "../../ui/badge";
import { emailWithBreak } from "../../ui/email-with-break";
import { Icon } from "../../ui/icon";
import { ListGroup } from "../../ui/list";
import { listRowLayout } from "../../ui/list-row-layout";
import { Text } from "../../ui/text";
import { space } from "../../ui/tokens";

/**
 * The account's login email, read-only: the address whole, a Verified badge
 * pinned top right, and the note that it can't be changed here.
 */
export function LoginEmailCard({ email }: { readonly email: string }) {
  const locale = useAppLocale();
  return (
    <ListGroup>
      <View accessible style={[listRowLayout.row, styles.row]}>
        <View style={listRowLayout.iconTile}>
          <Icon icon={Mail} size={20} />
        </View>
        <View style={[listRowLayout.text, styles.text]}>
          <Text variant="bodyStrong">{emailWithBreak(email)}</Text>
          <Text variant="bodySmall">
            {m.profile_email_fixed({}, { locale })}
          </Text>
        </View>
        <View style={styles.badge}>
          <Badge
            tone="positive"
            icon={Check}
            label={m.profile_email_verified_badge({}, { locale })}
          />
        </View>
      </View>
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-start" },
  // The badge takes its own room at the top right, so a long address wraps
  // under it rather than running beneath it.
  text: { paddingTop: space.xxs },
  badge: { marginRight: -space.xs },
});
