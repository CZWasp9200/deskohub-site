import { Effect, Option } from "effect";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import Mail from "lucide-react-native/icons/mail";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trackSignInCompleted } from "../analytics/events";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button } from "../ui/controls";
import { Notice, type NoticeTone } from "../ui/notice";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { signInWithEmail } from "./native-sign-in";
import {
  type NativeSignInFailure,
  SignInUnavailable,
} from "./native-sign-in-errors";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import { SignInLocale } from "./sign-in-locale";
import { SignInMasthead } from "./sign-in-masthead";
import { isSignInRetry } from "./sign-in-retry";
import { useAuthSession } from "./use-auth-session";
import { useAuthTask } from "./use-auth-task";

/**
 * What the sign-in screen gives its passkey option. A screen runs one
 * sign-in method at a time, so a ceremony can't change the session while
 * another method finishes, or the other way round.
 */
export interface PasskeyOptionProps {
  /**
   * Runs once the passkey has signed in: it records the sign-in and, on the
   * web page, checks the account and hands the session to the app that asked
   * for it.
   */
  readonly onSignedIn: () => void;
  /** Another sign-in method is running, so the option can't start. */
  readonly disabled: boolean;
  /**
   * Called with `true` before the option's ceremony can change the session,
   * and with `false` only once `onSignedIn` has run or the ceremony ended.
   */
  readonly onPendingChange: (pending: boolean) => void;
  /**
   * The ceremony ended without a passkey: the customer closed the system
   * sheet, or this device has none. The screen then says so, instead of the
   * option returning silently. Without it the option settles both quietly.
   */
  readonly onNotUsed?: () => void;
}

/**
 * The sign-in screen's props. `passkeyOption` renders the passkey sign-in
 * option, which is delivered separately.
 */
export interface SignInScreenProps {
  readonly passkeyOption?: (option: PasskeyOptionProps) => ReactNode;
}

const recordPasskeySignIn = (): void => trackSignInCompleted("passkey");

const signInWithEmailNow = (locale: AppLocale) =>
  signInWithEmail(Option.none()).pipe(
    Effect.provideService(SignInLocale, locale)
  );
const unexpected = () => new SignInUnavailable({});

interface ScreenNotice {
  readonly tone: NoticeTone;
  readonly message: string;
}

/**
 * What an email attempt's failure tells the customer here: closing the
 * browser tab is a calm note, anything else says what went wrong.
 */
const emailFailureNotice = (
  failure: NativeSignInFailure,
  locale: AppLocale
): ScreenNotice =>
  failure._tag === "SignInCancelled"
    ? { tone: "info", message: m.signin_cancelled_notice({}, { locale }) }
    : { tone: "error", message: nativeSignInFailureMessage(failure, locale) };

/**
 * The native sign-in screen. "Continue with email" opens the web sign-in
 * page in an in-app browser tab; the session lands back through the
 * callback route, and the signed-in state redirects home. A cancelled
 * attempt or an unused passkey leaves a note above the actions.
 */
export function SignInScreen({ passkeyOption }: SignInScreenProps) {
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const session = useAuthSession();
  const { state, start, reset } = useAuthTask(
    nativeAuthRuntime,
    signInWithEmailNow,
    unexpected
  );

  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyNotUsed, setPasskeyNotUsed] = useState(false);
  // A passkey attempt replaces the email sign-in's earlier note, so it
  // doesn't stay up during and after the attempt.
  const handlePasskeyPendingChange = (pending: boolean) => {
    if (pending) {
      reset();
      setPasskeyNotUsed(false);
    }
    setPasskeyPending(pending);
  };
  const startEmail = () => {
    setPasskeyNotUsed(false);
    void start(locale);
  };

  // "Start again" on a failed callback opens this screen to start a new
  // email sign-in once: the request is taken off the route before it runs,
  // and the guard holds it if the effect runs again first.
  const retry = isSignInRetry(useLocalSearchParams<{ start?: string }>());
  const retried = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per request; startEmail changes every render.
  useEffect(() => {
    if (!retry) {
      retried.current = false;
      return;
    }
    if (retried.current) return;
    retried.current = true;
    router.setParams({ start: undefined });
    startEmail();
  }, [retry]);

  if (session.status === "signed-in") return <Redirect href="/" />;

  const restoring = session.status === "restoring";
  const running = state.status === "running";
  const emailNotice =
    state.status === "failed"
      ? emailFailureNotice(state.failure, locale)
      : undefined;
  const notice: ScreenNotice | undefined = passkeyNotUsed
    ? { tone: "info", message: m.passkey_sign_in_not_used({}, { locale }) }
    : emailNotice;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      <SignInMasthead />
      <View
        style={[styles.actions, { paddingBottom: insets.bottom + space.md }]}
      >
        <Notice tone={notice?.tone ?? "info"} message={notice?.message} />
        <Button
          label={
            running
              ? m.signin_opening({}, { locale })
              : m.signin_continue_with_email({}, { locale })
          }
          icon={Mail}
          busy={running}
          onPress={startEmail}
          // A session re-read while the attempt runs keeps it busy, not
          // disabled.
          disabled={(restoring && !running) || passkeyPending}
        />
        {passkeyOption !== undefined && (
          <>
            <View style={styles.divider}>
              <View style={styles.rule} />
              <Text variant="hint" style={styles.or}>
                {m.signin_or({}, { locale })}
              </Text>
              <View style={styles.rule} />
            </View>
            {passkeyOption({
              onSignedIn: recordPasskeySignIn,
              disabled: restoring || running,
              onPendingChange: handlePasskeyPendingChange,
              onNotUsed: () => setPasskeyNotUsed(true),
            })}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  content: { flexGrow: 1 },
  actions: {
    backgroundColor: color.paper,
    gap: space.md,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
  },
  divider: { alignItems: "center", flexDirection: "row", gap: space.md },
  rule: { backgroundColor: color.line, flex: 1, height: 1 },
  or: { color: color.ink2 },
});
