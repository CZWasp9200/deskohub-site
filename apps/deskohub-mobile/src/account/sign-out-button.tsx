import LogOut from "lucide-react-native/icons/log-out";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { SignOutFailure, signOut } from "../auth/sign-out";
import { standaloneTaskRuntime, useAuthTask } from "../auth/use-auth-task";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button, LiveMessage } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { Icon } from "../ui/icon";
import { Notice } from "../ui/notice";
import { color, touchTarget } from "../ui/tokens";

const runSignOut = () => signOut;
const unexpectedSignOutFailure = () => new SignOutFailure();

/**
 * The sign-out icon at the top right of the account's identity screens: a
 * crimson icon with no background that asks once before signing out. The
 * dialog stays while the sign-out runs and says so if it fails; a
 * successful sign-out leaves the signed-in screens altogether.
 */
export function SignOutButton() {
  const locale = useAppLocale();
  const [asking, setAsking] = useState(false);
  const signingOut = useAuthTask(
    standaloneTaskRuntime,
    runSignOut,
    unexpectedSignOutFailure
  );
  const running = signingOut.state.status === "running";
  const close = () => {
    if (running) return;
    setAsking(false);
    signingOut.reset();
  };
  return (
    <>
      <Pressable
        role="button"
        aria-label={m.account_sign_out({}, { locale })}
        onPress={() => setAsking(true)}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Icon icon={LogOut} color={color.danger} />
      </Pressable>
      <Dialog
        visible={asking}
        role="alertdialog"
        title={m.account_sign_out_title({}, { locale })}
        busy={running}
        onDismiss={close}
        actions={[
          <Button
            key="sign-out"
            variant="danger"
            icon={LogOut}
            label={m.account_sign_out({}, { locale })}
            busy={running}
            onPress={() => void signingOut.start()}
          />,
          <Button
            key="stay"
            variant="quiet"
            label={m.account_sign_out_stay({}, { locale })}
            disabled={running}
            onPress={close}
          />,
          <LiveMessage
            key="progress"
            role="status"
            message={
              running ? m.account_signing_out({}, { locale }) : undefined
            }
          />,
        ]}
      >
        {/* Kept mounted so assistive tech announces the failure. */}
        <Notice
          tone="error"
          message={
            signingOut.state.status === "failed"
              ? m.account_sign_out_failed({}, { locale })
              : undefined
          }
        />
      </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: 0.6 },
});
