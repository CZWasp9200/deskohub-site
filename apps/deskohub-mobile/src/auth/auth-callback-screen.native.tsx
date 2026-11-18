import { Effect } from "effect";
import { router, useLocalSearchParams } from "expo-router";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button } from "../ui/controls";
import { EmptyState } from "../ui/empty-state";
import { FocusedStatusBar } from "../ui/focused-status-bar";
import { LoadingIndicator } from "../ui/loading-indicator";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";
import { useViewport } from "../ui/viewport";
import { useUpdateOfferHost } from "../updates/update-offer";
import { type AuthCallback, parseAuthCallbackParams } from "./auth-callback";
import { AuthPhotoSheet } from "./auth-photo-sheet";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { completeAuthCallback } from "./native-sign-in";
import { SignInUnavailable } from "./native-sign-in-errors";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import { SignInLocale } from "./sign-in-locale";
import { signInRetryParams } from "./sign-in-retry";
import { useAuthSession } from "./use-auth-session";
import { useAuthTask } from "./use-auth-task";

const unexpected = () => new SignInUnavailable({});

/** Finishes the callback in the language the screen shows. */
const completeCallback = (callback: AuthCallback, locale: AppLocale) =>
  completeAuthCallback(callback).pipe(
    Effect.provideService(SignInLocale, locale)
  );

const leave = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/");
};

/** Back to the sign-in screen under this one, or a new one. */
const backToSignIn = () => router.dismissTo("/sign-in");

/** A new email sign-in, started from the sign-in screen. */
const startAgain = () =>
  router.dismissTo({ pathname: "/sign-in", params: signInRetryParams });

/**
 * `/auth/callback`: the magic-link App Link and the handoff return land here,
 * on a warm or a cold start. It finishes the sign-in (once, even if the auth
 * session reports the same URL) on its own navy screen, and goes back to
 * where the customer was. A failure says what happened and offers the next
 * step.
 */
export function AuthCallbackScreen() {
  const { isWide } = useViewport();
  // Signing in is brief and part of the sign-in flow: no update offer here.
  useUpdateOfferHost();
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const {
    token,
    code,
    state: handoffState,
    error,
    method,
  } = useLocalSearchParams();
  // A second link may reuse this screen with new params; each distinct
  // callback is finished (the registry dedupes repeats of the same one).
  const callback = useMemo(
    () =>
      parseAuthCallbackParams({
        token,
        code,
        state: handoffState,
        error,
        method,
      }),
    [token, code, handoffState, error, method]
  );
  const session = useAuthSession();
  const { state, start } = useAuthTask(
    nativeAuthRuntime,
    completeCallback,
    unexpected
  );

  useEffect(() => {
    void start(callback, locale);
  }, [start, callback, locale]);

  // Where the session first settled while this screen showed. Signed out
  // there, a session that lands is this sign-in's, even when reading its
  // account then failed: the app is signed in (and says so), so it goes on
  // rather than reporting a failure. A reauthentication starts signed in.
  const [arrivedSignedIn, setArrivedSignedIn] = useState<boolean>();
  if (arrivedSignedIn === undefined && session.status !== "restoring") {
    setArrivedSignedIn(session.status === "signed-in");
  }
  const completed = state.status === "succeeded";
  const signedIn = session.status === "signed-in";
  const landed = signedIn && arrivedSignedIn === false;
  useEffect(() => {
    if ((completed || landed) && signedIn) leave();
  }, [completed, landed, signedIn]);

  if (state.status !== "failed") {
    return (
      <View
        style={[
          styles.completing,
          { paddingBottom: insets.bottom, paddingTop: insets.top },
        ]}
      >
        <FocusedStatusBar style="light" />
        {/* The status below says what's under way. */}
        <LoadingIndicator size="screen" tone="brand" />
        <Text
          variant="title"
          tone="inverse"
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {m.callback_completing({}, { locale })}
        </Text>
      </View>
    );
  }

  const title = m.callback_failed_title({}, { locale });
  const body = nativeSignInFailureMessage(state.failure, locale);
  // A refused callback preserves the current session and returns to its screen.
  const actions = signedIn ? (
    <Button label={m.callback_go_back({}, { locale })} onPress={leave} />
  ) : (
    <View style={styles.actions}>
      <Button
        label={m.callback_start_again({}, { locale })}
        icon={RotateCcw}
        onPress={startAgain}
      />
      <Button
        variant={isWide ? "secondary" : "quiet"}
        label={m.callback_back_to_sign_in({}, { locale })}
        onPress={backToSignIn}
      />
    </View>
  );

  if (isWide) {
    return (
      <AuthPhotoSheet title={title} body={body} alert>
        {actions}
      </AuthPhotoSheet>
    );
  }

  return (
    <ScrollView
      style={styles.failedScreen}
      contentContainerStyle={[
        styles.failed,
        { paddingBottom: insets.bottom + space.lg, paddingTop: insets.top },
      ]}
    >
      <FocusedStatusBar style="dark" />
      <EmptyState
        icon={CircleAlert}
        tone="danger"
        live="assertive"
        title={title}
        body={body}
      >
        {actions}
      </EmptyState>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  completing: {
    alignItems: "center",
    backgroundColor: color.navy,
    flex: 1,
    gap: space.xl,
    justifyContent: "center",
    paddingHorizontal: space.xxl,
  },
  status: { textAlign: "center" },
  failedScreen: { backgroundColor: color.paper, flex: 1 },
  failed: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.lg },
});
