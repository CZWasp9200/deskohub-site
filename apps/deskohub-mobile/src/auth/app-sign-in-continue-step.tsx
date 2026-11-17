import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button } from "../ui/controls";
import { emailWithBreak } from "../ui/email-with-break";
import { Text } from "../ui/text";
import { color, radius, shadow, space } from "../ui/tokens";
import { AppSignInLayout } from "./app-sign-in-layout";
import {
  SignInStepMessage,
  type SignInStepNotice,
} from "./sign-in-step-message";

/**
 * Up to two initials for an account known only by its email: the first
 * letters of the first two parts of the address before the @
 * (`jana.novakova@…` is JN), else its first letter.
 */
export const emailInitials = (email: string): string =>
  (email.split("@")[0] ?? "")
    .split(/[._+-]+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join("");

/**
 * The sign-in page the app opens, when this browser is already signed in:
 * the account it would continue as, and one action back to the app.
 */
export function AppSignInContinueStep({
  email,
  onContinue,
  continuing,
  notice,
  onUseDifferentEmail,
}: {
  readonly email: string;
  readonly onContinue: () => void;
  readonly continuing: boolean;
  readonly notice: SignInStepNotice | undefined;
  readonly onUseDifferentEmail: () => void;
}) {
  const locale = useAppLocale();
  return (
    <AppSignInLayout
      title={m.signin_already_signed_in({}, { locale })}
      onUseDifferentEmail={onUseDifferentEmail}
      useDifferentEmailDisabled={continuing}
      action={
        <Button
          label={m.signin_continue({}, { locale })}
          onPress={onContinue}
          busy={continuing}
        />
      }
    >
      <View style={styles.account}>
        <View aria-hidden style={styles.avatar}>
          <Text variant="label" tone="inverse" style={styles.initials}>
            {emailInitials(email)}
          </Text>
        </View>
        <View style={styles.identity}>
          <Text variant="bodyStrong" style={styles.email}>
            {/* A long address wraps before the @, not inside a word. */}
            {emailWithBreak(email)}
          </Text>
        </View>
      </View>
      <SignInStepMessage notice={notice} />
    </AppSignInLayout>
  );
}

const styles = StyleSheet.create({
  account: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    flexDirection: "row",
    // At a large text size the address moves under the avatar instead of
    // breaking between its letters.
    flexWrap: "wrap",
    gap: 14,
    minHeight: 72,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...shadow.group,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: color.navy,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  initials: { fontSize: 15 },
  identity: { flexBasis: 160, flexGrow: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  email: { fontSize: 15 },
});
