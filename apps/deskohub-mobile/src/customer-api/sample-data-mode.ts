import { Schema } from "effect";

/** The account states the sample-data mode can show. */
export const sampleAccountKinds = [
  "linked",
  "completion-required",
  "support-required",
  "authenticated-unavailable",
  "review-account",
  "deletion-pending",
] as const;
const SampleAccountKind = Schema.Literals(sampleAccountKinds);
export type SampleAccountKind = typeof SampleAccountKind.Type;

const isSampleAccountKind = Schema.is(SampleAccountKind);

export type SampleDataMode =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly kind: SampleAccountKind };

/**
 * Whether account screens show synthetic sample data instead of the
 * Workspace's, for screenshot evidence of states a preview can't seed. Only a
 * development build with `EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA=1` turns it on;
 * `EXPO_PUBLIC_ACCOUNT_SAMPLE_KIND` picks the first account state.
 */
export const resolveSampleDataMode = ({
  isDevelopmentBuild,
  flag,
  kind,
}: {
  readonly isDevelopmentBuild: boolean;
  readonly flag: string | undefined;
  readonly kind: string | undefined;
}): SampleDataMode =>
  isDevelopmentBuild && flag === "1"
    ? { enabled: true, kind: isSampleAccountKind(kind) ? kind : "linked" }
    : { enabled: false };

/** The next account state in the dev menu's cycle. */
export const nextSampleAccountKind = (
  kind: SampleAccountKind
): SampleAccountKind =>
  sampleAccountKinds[
    (sampleAccountKinds.indexOf(kind) + 1) % sampleAccountKinds.length
  ] ?? "linked";

/**
 * The feature flags a development build's sample data switches on, so a
 * capture can show a row its release still hides:
 * `EXPO_PUBLIC_ACCOUNT_SAMPLE_FLAGS` lists flag keys, comma separated. Off
 * without sample data and in any other build.
 */
export const resolveSampleFeatureFlags = ({
  mode,
  flags,
}: {
  readonly mode: SampleDataMode;
  readonly flags: string | undefined;
}): ReadonlySet<string> =>
  new Set(
    mode.enabled
      ? (flags ?? "")
          .split(",")
          .map((flag) => flag.trim())
          .filter((flag) => flag !== "")
      : []
  );
