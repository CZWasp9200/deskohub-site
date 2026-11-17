import { useSyncExternalStore } from "react";
import {
  resolveSampleDataMode,
  resolveSampleFeatureFlags,
} from "../customer-api/sample-data-mode";
import { analytics } from "./analytics";

// A development build's sample data may switch flags on for screenshots of
// what they gate; Metro inlines the env, so release builds read none.
let sampleFeatureFlags: ReadonlySet<string> | undefined;
const sampleFeatureFlagOn = (flag: string) => {
  sampleFeatureFlags ??= resolveSampleFeatureFlags({
    mode: resolveSampleDataMode({
      isDevelopmentBuild: __DEV__,
      flag: process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA,
      kind: process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_KIND,
    }),
    flags: process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_FLAGS,
  });
  return sampleFeatureFlags.has(flag);
};

/**
 * Whether a flag value turns the feature on: a variant counts as on, and no
 * value yet gives the caller's fallback.
 */
export const resolveFeatureFlagEnabled = (
  value: boolean | string | undefined,
  fallback: boolean
): boolean => (value === undefined ? fallback : value !== false);

/**
 * Whether a PostHog feature flag is on for the settled identity. Returns
 * `fallback` until flags load, without analytics consent, and again after
 * consent is withdrawn; a flag the sample data switches on is on.
 */
export const useFeatureFlagEnabled = (
  flag: string,
  fallback: boolean
): boolean => {
  const read = () =>
    sampleFeatureFlagOn(flag) ||
    resolveFeatureFlagEnabled(analytics.featureFlag(flag), fallback);
  return useSyncExternalStore(analytics.subscribeFeatureFlags, read, read);
};
