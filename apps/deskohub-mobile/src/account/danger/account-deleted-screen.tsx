import { Effect } from "effect";
import { router } from "expo-router";
import { useState } from "react";
import { AuthPhotoSheet } from "../../auth/auth-photo-sheet";
import { standaloneTaskRuntime } from "../../auth/use-auth-task";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { BodyText, Button, LiveMessage, Screen } from "../../ui/controls";
import { useViewport } from "../../ui/viewport";
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
      <AuthPhotoSheet title={title} body={body}>
        {actions}
      </AuthPhotoSheet>
    );
  }
  return (
    <Screen title={title}>
      <BodyText>{body}</BodyText>
      {actions}
    </Screen>
  );
}
