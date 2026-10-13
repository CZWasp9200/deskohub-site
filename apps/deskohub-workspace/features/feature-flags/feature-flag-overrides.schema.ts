import { Schema, SchemaGetter } from "effect";

export const vercelEnvironmentSchema = Schema.Literals([
  "production",
  "preview",
  "development",
]);

/**
 * Overrides as configured for the deployment. Keys are not checked against the
 * generated contract here because a shared preview value may name flags this
 * build does not know yet; `resolveFeatureFlagOverrides` drops those keys.
 */
const configuredFeatureFlagOverridesSchema = Schema.Record(
  Schema.String,
  Schema.Boolean
);

export const postHogFeatureFlagOverridesSchema = Schema.optional(
  Schema.Union([
    Schema.Literal(""),
    Schema.fromJsonString(configuredFeatureFlagOverridesSchema),
  ])
).pipe(
  Schema.decodeTo(Schema.optional(configuredFeatureFlagOverridesSchema), {
    decode: SchemaGetter.transform((overrides) =>
      overrides === "" ||
      (overrides !== undefined && Object.keys(overrides).length === 0)
        ? undefined
        : overrides
    ),
    encode: SchemaGetter.transform((overrides) => overrides),
  })
);

export const postHogFeatureFlagOverridesEnvironmentCheck = Schema.makeFilter<{
  readonly POSTHOG_FEATURE_FLAG_OVERRIDES?:
    | Readonly<Record<string, boolean>>
    | undefined;
  readonly VERCEL_ENV: "production" | "preview" | "development";
}>((environment) =>
  environment.VERCEL_ENV === "production" &&
  environment.POSTHOG_FEATURE_FLAG_OVERRIDES !== undefined
    ? {
        path: ["POSTHOG_FEATURE_FLAG_OVERRIDES"],
        issue:
          "Feature flag overrides are only allowed in preview or development deployments.",
      }
    : undefined
);

export const postHogFeatureFlagOverrideEnvironmentSchema = Schema.Struct({
  POSTHOG_FEATURE_FLAG_OVERRIDES: postHogFeatureFlagOverridesSchema,
  VERCEL_ENV: vercelEnvironmentSchema,
}).check(postHogFeatureFlagOverridesEnvironmentCheck);
