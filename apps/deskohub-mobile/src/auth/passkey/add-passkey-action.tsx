import KeyRound from "lucide-react-native/icons/key-round";
import Plus from "lucide-react-native/icons/plus";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { space } from "../../ui/tokens";
import type { AddedPasskey } from "./passkey-ceremony";
import { addPasskeyFailureMessage } from "./passkey-failure-message";
import { usePasskeyCeremony } from "./use-passkey-ceremony";

/**
 * Saves a new passkey to the signed-in account. Adding one needs a recent
 * sign-in: when the session is too old, the action calls
 * `onReauthenticationRequired` and returns to idle, so the customer can try
 * again once they have signed in again. `onStart` runs before the passkey
 * prompt opens and `onSettled` once the ceremony has ended, after `onAdded`
 * or `onReauthenticationRequired`, so the screen can hold its other
 * controls and announce the progress meanwhile.
 *
 * The button waits for the device while the prompt is open. A failure shows
 * its cause above "Try again"; closing the system prompt is a cancel and
 * shows nothing. `first` is the one orange action of an account without
 * passkeys; `another` sits under the list.
 */
export function AddPasskeyAction({
  name,
  kind,
  onAdded,
  onReauthenticationRequired,
  onStart,
  onSettled,
}: {
  /** The passkey's name; the server names it after its provider otherwise. */
  readonly name?: string;
  readonly kind: "first" | "another";
  readonly onAdded?: (passkey: AddedPasskey) => void;
  readonly onReauthenticationRequired: () => void;
  readonly onStart?: () => void;
  readonly onSettled?: () => void;
}) {
  const locale = useAppLocale();
  const { state, start } = usePasskeyCeremony({
    ceremony: (ceremonies) => ceremonies.addPasskey({ name }),
    onPendingChange: (pending) => (pending ? onStart?.() : onSettled?.()),
    onSucceeded: onAdded,
    takeOver: (failure) => {
      if (
        failure._tag !== "PasskeyRejected" ||
        !failure.needsReauthentication
      ) {
        return false;
      }
      onReauthenticationRequired();
      return true;
    },
  });
  const pending = state.status === "pending";
  const failed = state.status === "failed";
  const idle =
    kind === "first"
      ? { label: m.passkey_add({}, { locale }), icon: KeyRound }
      : { label: m.passkey_add_another({}, { locale }), icon: Plus };
  const shown = failed
    ? { label: m.account_retry({}, { locale }), icon: RotateCcw }
    : idle;

  return (
    <View style={styles.action}>
      <Notice
        tone="error"
        title={failed ? m.passkey_add_failed_title({}, { locale }) : undefined}
        message={
          state.status === "failed"
            ? addPasskeyFailureMessage(state.failure, locale)
            : undefined
        }
      />
      <Button
        variant={kind === "first" || failed ? "primary" : "secondary"}
        icon={shown.icon}
        label={pending ? m.passkey_add_waiting({}, { locale }) : shown.label}
        busy={pending}
        accessibilityLabel={
          pending ? m.passkey_add_pending({}, { locale }) : undefined
        }
        onPress={start}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: "stretch", gap: space.md },
});
