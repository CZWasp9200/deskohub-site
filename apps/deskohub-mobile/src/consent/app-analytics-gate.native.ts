import { type AnalyticsGate, consentAnalyticsGate } from "./analytics-gate";
import { appAnalyticsConsent } from "./use-analytics-consent";

let gate: AnalyticsGate | undefined;

/** The native app's analytics follows its own stored consent. */
export const appAnalyticsGate = (): AnalyticsGate => {
  gate ??= consentAnalyticsGate(appAnalyticsConsent());
  return gate;
};
