import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { emailWithBreak } from "../ui/email-with-break";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";
import { AccountAvatar } from "./account-avatar";
import type { AccountIdentity } from "./account-root-model";

// Placeholder blocks on the navy band, where the warm skeleton would glare.
const onNavyBlock = "rgba(255,255,255,0.18)";
const onNavyLine = "rgba(255,255,255,0.14)";

/**
 * Who is signed in, on the Account masthead: the photo or initials, the
 * profile's name (or that there is none yet) and the login email, which
 * breaks only before its @. While the account first loads, the same layout
 * in placeholder blocks; when it couldn't be read, nothing.
 */
export function AccountIdentityView({
  identity,
  loading,
  noProfile,
}: {
  readonly identity: AccountIdentity | undefined;
  readonly loading: boolean;
  readonly noProfile: boolean;
}) {
  const locale = useAppLocale();
  if (loading)
    return (
      <View aria-hidden style={styles.identity}>
        <View style={[styles.avatarBlock, { backgroundColor: onNavyBlock }]} />
        <View style={styles.lines}>
          <View style={[styles.nameBlock, { backgroundColor: onNavyBlock }]} />
          <View style={[styles.emailBlock, { backgroundColor: onNavyLine }]} />
        </View>
      </View>
    );
  if (identity === undefined) return null;
  const name = noProfile
    ? m.account_identity_no_profile({}, { locale })
    : identity.name;
  return (
    <View style={styles.identity}>
      <AccountAvatar
        tone="on-navy"
        {...(identity.initials !== undefined && {
          initials: identity.initials,
        })}
        {...(identity.photoUrl !== undefined && {
          photoUrl: identity.photoUrl,
        })}
      />
      <View style={styles.who}>
        {name !== undefined && name !== "" && (
          <Text variant="dialogTitle" tone="inverse">
            {name}
          </Text>
        )}
        <Text variant="bodySmall" style={styles.email}>
          {emailWithBreak(identity.email)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    marginTop: space.xs,
  },
  who: { flex: 1, minWidth: 0 },
  email: { color: color.onNavyMuted },
  lines: { gap: space.sm },
  avatarBlock: { borderRadius: 28, height: 56, width: 56 },
  nameBlock: { borderRadius: 8, height: 16, width: 150 },
  emailBlock: { borderRadius: 5, height: 10, width: 190 },
});
