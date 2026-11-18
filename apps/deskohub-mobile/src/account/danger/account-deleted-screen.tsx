import { Effect } from "effect";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthPhotoSheet } from "../../auth/auth-photo-sheet";
import { standaloneTaskRuntime } from "../../auth/use-auth-task";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { BodyText, Button, LiveMessage } from "../../ui/controls";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import { useViewport } from "../../ui/viewport";
import { QuietUpdateOffer } from "../../updates/update-offer-card";
import { deletedAccountExit } from "./deleted-account-exit";

// A new sign-in waits for the deleted account's sign-out to settle: its late
// answer would clear the new session.
const backToSignIn = deletedAccountExit.settled.pipe(
  Effect.andThen(Effect.sync(() => router.replace("/sign-in")))
);

/**
 * Shown after the account was deleted and signed out. It sits outside the
 * signed-in guard and reads no customer data.
 */
export function AccountDeletedScreen() {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const [leaving, setLeaving] = useState(false);
  const title = m.account_deleted_title({}, { locale });
  const body = m.danger_deleted_body({}, { locale });
  const actions = (
    <>
      <Button
        label={m.danger_deleted_sign_in({}, { locale })}
        disabled={leaving}
        onPress={() => {
          setLeaving(true);
          standaloneTaskRuntime.runFork(backToSignIn);
        }}
      />
      <LiveMessage
        role="status"
        message={leaving ? m.danger_signing_out({}, { locale }) : undefined}
      />
    </>
  );
  if (isWide) {
    return (
      <AuthPhotoSheet
        title={title}
        body={body}
        updateOffer={<QuietUpdateOffer backdrop="navy" />}
      >
        {actions}
      </AuthPhotoSheet>
    );
  }
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" variant="titleLarge">
          {title}
        </Text>
        <BodyText>{body}</BodyText>
        {actions}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: color.paper, flex: 1 },
  content: {
    alignSelf: "center",
    flexGrow: 1,
    gap: space.md,
    justifyContent: "center",
    maxWidth: 480,
    padding: space.gutter,
    width: "100%",
  },
});
