import { brandFontVariation } from "@deskohub/brand-tokens";
import Interpolate from "@doist/react-interpolate";
import Mail from "lucide-react-native/icons/mail";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button } from "../ui/controls";
import { emailWithBreak } from "../ui/email-with-break";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";
import { AppSignInLayout } from "./app-sign-in-layout";
import { SignInCodeInput, signInCodeLength } from "./sign-in-code-input.web";
import { SignInResend, useResendSecondsLeft } from "./sign-in-resend";
import {
  SignInStepMessage,
  type SignInStepNotice,
} from "./sign-in-step-message";

/**
 * The code step of the sign-in page the app opens: the six code boxes in the
 * middle, then the wait for another email or the action that sends it, and
 * "Sign in" at the bottom, enabled once all six digits are in. The sixth
 * digit submits on its own, as on the site.
 *
 * After too many wrong codes (`exhausted`) the boxes lock and the bottom
 * action sends a new code to the same address instead, once the server takes
 * another email (`resendAvailableAt`).
 */
export function AppSignInCodeStep({
  email,
  code,
  onCodeChange,
  onSubmit,
  checking,
  invalid,
  exhausted,
  notice,
  resendAvailableAt,
  onResend,
  resending,
  onUseDifferentEmail,
}: {
  readonly email: string;
  readonly code: string;
  readonly onCodeChange: (code: string) => void;
  readonly onSubmit: (code: string) => void;
  /** The code is being checked, or the sign-in is being finished. */
  readonly checking: boolean;
  /** The last code was wrong or expired. */
  readonly invalid: boolean;
  /** Too many wrong codes: this code can no longer work. */
  readonly exhausted: boolean;
  readonly notice: SignInStepNotice | undefined;
  /** Epoch ms from which another email may be sent. */
  readonly resendAvailableAt: number;
  readonly onResend: () => void;
  readonly resending: boolean;
  readonly onUseDifferentEmail: () => void;
}) {
  const locale = useAppLocale();
  const messageId = useId();
  const busy = checking || resending;
  const resendWait = useResendSecondsLeft(resendAvailableAt);
  const action = exhausted ? (
    <Button
      label={m.signin_send_new_code({}, { locale })}
      icon={Mail}
      onPress={onResend}
      busy={resending}
      disabled={!resending && resendWait > 0}
    />
  ) : (
    <Button
      label={
        checking
          ? m.signin_signing_in({}, { locale })
          : m.signin_sign_in({}, { locale })
      }
      onPress={() => onSubmit(code)}
      busy={checking}
      disabled={!checking && (resending || code.length !== signInCodeLength)}
    />
  );
  return (
    <AppSignInLayout
      title={m.signin_sent_title({}, { locale })}
      instructions={
        <Interpolate
          string={m.signin_code_body({}, { locale })}
          mapping={{
            email: (
              <Text style={styles.email}>
                {/* A long address wraps before the @, not inside a word. */}
                {emailWithBreak(email)}
              </Text>
            ),
          }}
        />
      }
      onUseDifferentEmail={onUseDifferentEmail}
      useDifferentEmailDisabled={busy}
      action={action}
    >
      <View>
        <SignInCodeInput
          value={code}
          onChange={onCodeChange}
          onComplete={onSubmit}
          label={m.signin_code_label({}, { locale })}
          invalid={invalid}
          disabled={busy || exhausted}
          describedBy={messageId}
        />
        <SignInStepMessage id={messageId} notice={notice} />
      </View>
      <View style={styles.resend}>
        <SignInResend
          availableAt={resendAvailableAt}
          what="code"
          onResend={onResend}
          busy={resending}
          disabled={checking}
          countdownOnly={exhausted}
        />
      </View>
    </AppSignInLayout>
  );
}

const styles = StyleSheet.create({
  resend: { marginTop: space.md },
  email: {
    color: color.navy,
    fontVariationSettings: brandFontVariation(600),
    fontWeight: "600",
  },
});
