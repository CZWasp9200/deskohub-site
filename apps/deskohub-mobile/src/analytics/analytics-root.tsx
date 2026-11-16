import { usePathname, useSegments } from "expo-router";
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Platform } from "react-native";
import type { AuthSessionState } from "../auth/auth-session-state";
import { useAuthSession } from "../auth/use-auth-session";
import {
  accountConsentCheckEnabled,
  appAccountConsentCheck,
  useConsentPromptWaits,
} from "../consent/account-consent-check";
import { appAnalyticsGate } from "../consent/app-analytics-gate";
import { ConsentPrompt } from "../consent/consent-prompt";
import { useAnalyticsConsent } from "../consent/use-analytics-consent";
import { analytics, setAnalyticsIdentity } from "./analytics";
import {
  classifyDeploymentEnvironment,
  resolveAnalyticsSettings,
} from "./analytics-settings";
import { trackScreenView } from "./events";
import { detectOtherPostHogSdk } from "./other-posthog-sdk";
import { clearPostHogStoredState, createPostHogClient } from "./posthog-client";
import { screenPathPattern } from "./screen-path";
import { analyticsIdentityOf } from "./session-identity";

/** The account consent check, on the platforms that check (not the web). */
const accountCheck = accountConsentCheckEnabled
  ? appAccountConsentCheck
  : undefined;

const webHostname = () =>
  Platform.OS === "web" ? window.location.hostname : undefined;

const connectAnalytics = () =>
  analytics.connect({
    settings: resolveAnalyticsSettings({
      apiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY,
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
      appHostname: webHostname(),
      environment: classifyDeploymentEnvironment({
        hostname: webHostname(),
        isDevelopmentBuild: __DEV__,
      }),
    }),
    createClient: createPostHogClient,
    detectOtherSdk: () =>
      Platform.OS === "web" && detectOtherPostHogSdk(window),
    consent: appAnalyticsGate(),
    accountCheck,
    clearStoredState: clearPostHogStoredState,
    warn: (message) => console.warn(message),
  });

/**
 * Attributes analytics to the signed-in account
 * (`workspace-account:<accountId>`), and to no one once signed out. Holds
 * while the stored session is restored. The account consent check follows
 * the same session first, so a new account is held from the start.
 */
const useSessionAnalyticsIdentity = (session: AuthSessionState) => {
  const identity = analyticsIdentityOf(session);
  // Effects key on the identity's parts: each session refetch is a new object.
  const { kind } = identity;
  const accountId =
    identity.kind === "authenticated" ? identity.accountId : undefined;
  const testAccount = identity.kind === "authenticated" && identity.testAccount;
  useEffect(() => {
    if (kind !== "pending") appAccountConsentCheck.follow(accountId);
    if (accountId !== undefined) {
      setAnalyticsIdentity({ kind: "authenticated", accountId, testAccount });
    } else if (kind !== "authenticated") {
      setAnalyticsIdentity({ kind });
    }
  }, [kind, accountId, testAccount]);
};

/**
 * Connects analytics for the app's lifetime, records screen views and asks
 * for analytics consent while there is no answer, once the session's first
 * account check has settled (`useConsentPromptWaits`). Analytics follows the
 * page's gate (`appAnalyticsGate`): on the web page the native app opened
 * for its sign-in, the app's carried answer, and the prompt never shows.
 */
export function AnalyticsRoot({ children }: { readonly children: ReactNode }) {
  const session = useAuthSession();
  const consent = useAnalyticsConsent();
  const gate = appAnalyticsGate();
  const status = useSyncExternalStore(gate.subscribe, gate.status, gate.status);
  const promptWaits = useConsentPromptWaits(accountCheck, session);
  // Dismissing the prompt answers nothing; it asks again on the next launch.
  const [promptDismissed, setPromptDismissed] = useState(false);
  // Views record the route pattern (`/reservations/[orderId]`), never the
  // concrete path; the path only marks a new view, such as another order.
  const screen = screenPathPattern(useSegments());
  const pathname = usePathname();
  // Screen views wait in memory while the answer loads; a later grant records
  // the current screen again, since it was dropped while undecided.
  const recording = status === "granted" || status === "loading";

  useEffect(connectAnalytics, []);
  useSessionAnalyticsIdentity(session);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname records a new view when only the order changes.
  useEffect(() => {
    if (recording) trackScreenView(screen);
  }, [pathname, screen, recording]);

  return (
    <>
      {children}
      {gate.asks &&
        consent.status === "undecided" &&
        !promptWaits &&
        !promptDismissed && (
          <ConsentPrompt
            onAccept={consent.grant}
            onDecline={consent.deny}
            onDismiss={() => setPromptDismissed(true)}
          />
        )}
    </>
  );
}
