import KeyRound from "lucide-react-native/icons/key-round";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { trackSignInStarted } from "../../analytics/events";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button, LiveMessage } from "../../ui/controls";
import { space } from "../../ui/tokens";
import type { PasskeyFailure } from "./passkey-failure";
import { passkeySignInFailureMessage } from "./passkey-failure-message";
import { usePasskeyCeremony } from "./use-passkey-ceremony";

/** Ends without a passkey: the sheet was closed, or there is none here. */
const isNotUsed = (failure: PasskeyFailure) =>
  failure._tag === "PasskeyCancelled" || failure._tag === "PasskeyNoCredential";

/**
 * Signs in with a passkey saved for Deskohub. `onSignedIn` runs once the
 * session exists and the auth client has been told to refresh it; its
 * session data may still be loading. `onPendingChange` reports while the
 * ceremony may change the session, and `disabled` holds the option while
 * another sign-in method runs. With `onNotUsed`, a closed system sheet or a
 * device without a passkey goes to the screen to explain, instead of
 * settling quietly or as the option's own failure.
 */
export function PasskeySignInOption({
  onSignedIn,
  disabled = false,
  onPendingChange,
  onNotUsed,
}: {
  readonly onSignedIn: () => void;
  readonly disabled?: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly onNotUsed?: () => void;
}) {
  const locale = useAppLocale();
  const { state, start, clearFailure } = usePasskeyCeremony({
    ceremony: (ceremonies) => ceremonies.signIn,
    onSucceeded: onSignedIn,
    // A ceremony goes pending as it starts, so this records each attempt once.
    onPendingChange: (pending) => {
      if (pending) trackSignInStarted("passkey");
      onPendingChange?.(pending);
    },
    takeOver: (failure) => {
      if (onNotUsed === undefined || !isNotUsed(failure)) return false;
      onNotUsed();
      return true;
    },
  });
  const pending = state.status === "pending";
  // Another sign-in method starting holds this option; its earlier failure
  // then gives way to that attempt.
  useEffect(() => {
    if (disabled) clearFailure();
  }, [disabled, clearFailure]);

  return (
    <View style={styles.option}>
      <Button
        variant="secondary"
        icon={KeyRound}
        label={
          pending
            ? m.passkey_sign_in_pending({}, { locale })
            : m.passkey_sign_in({}, { locale })
        }
        busy={pending}
        disabled={disabled}
        onPress={start}
      />
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="alert"
        message={
          state.status === "failed"
            ? passkeySignInFailureMessage(state.failure, locale)
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  option: { alignSelf: "stretch", gap: space.sm },
});
