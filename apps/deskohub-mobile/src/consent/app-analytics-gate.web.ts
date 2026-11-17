import { Option } from "effect";
import { loadNativeHandoffRequest } from "../auth/web-native-request-store";
import {
  type AnalyticsGate,
  consentAnalyticsGate,
  nativeHandoffAnalyticsGate,
} from "./analytics-gate";
import { appAnalyticsConsent } from "./use-analytics-consent";

let gate: AnalyticsGate | undefined;

/**
 * This page load's analytics consent: the site's cookie, unless the native
 * app's sign-in request is live (the page it opened, or the tab its sign-in
 * email opens), which carries the app's own answer. Read once, on first use,
 * after the entry moved the request out of the address bar.
 */
export const appAnalyticsGate = (): AnalyticsGate => {
  gate ??= Option.match(loadNativeHandoffRequest(Date.now()), {
    onNone: () => consentAnalyticsGate(appAnalyticsConsent()),
    onSome: (request) =>
      nativeHandoffAnalyticsGate(appAnalyticsConsent(), request),
  });
  return gate;
};
