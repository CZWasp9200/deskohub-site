import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { Schema } from "effect";
import {
  type PostHogFeatureFlagDefinitions,
  postHogFeatureFlags,
} from "./generated/contract";

const postHogFeatureFlagKeySet = new Set<string>(postHogFeatureFlags.keys);
const decodeContractFeatureFlagOverrides = Schema.decodeUnknownSync(
  Schema.Record(
    Schema.Literals(postHogFeatureFlags.keys),
    Schema.optional(Schema.Boolean)
  )
);

/**
 * Narrows deployment-configured overrides to this build's generated contract.
 * The shared preview value can name flags that a branch has not synchronized
 * yet, so unknown keys are dropped with a warning that names only the keys.
 * Production never reaches this with a map because environment validation
 * rejects every non-empty override map there.
 */
export const resolveFeatureFlagOverrides = (
  configuredOverrides: Readonly<Record<string, boolean>> | undefined
): PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions> | undefined => {
  if (configuredOverrides === undefined) return undefined;

  const unknownKeys = Object.keys(configuredOverrides).filter(
    (key) => !postHogFeatureFlagKeySet.has(key)
  );
  if (unknownKeys.length > 0) {
    console.warn(
      `Ignoring PostHog feature flag overrides for keys missing from the generated contract: ${unknownKeys.join(", ")}`
    );
  }

  const overrides = decodeContractFeatureFlagOverrides(configuredOverrides);
  return Object.keys(overrides).length === 0 ? undefined : overrides;
};
