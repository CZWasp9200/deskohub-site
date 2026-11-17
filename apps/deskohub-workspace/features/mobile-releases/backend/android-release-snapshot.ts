import "server-only";

import { Effect, Match, Option } from "effect";
import { fromSharedSnapshot } from "@/shared/backend/shared-snapshot";
import type { AndroidRelease } from "../android-release";
import { MobileReleaseLookupError } from "./android-release-lookup";

/**
 * What one shared release lookup found. A plain object, not an `Option` or
 * tagged class, because the cache serializes it.
 */
export type AndroidReleaseSnapshot =
  | { readonly outcome: "found"; readonly release: AndroidRelease }
  | { readonly outcome: "none" }
  | { readonly outcome: "lookup-failed" };

export const toAndroidReleaseSnapshot: (
  release: Option.Option<AndroidRelease>
) => AndroidReleaseSnapshot = Option.match({
  onNone: () => ({ outcome: "none" }),
  onSome: (release) => ({ outcome: "found", release }),
});

/**
 * A failed lookup is shared as a value, not thrown: under Cache Components a
 * throwing `"use cache"` function fails a prerender even when its caller
 * catches it. It refreshes after two minutes; its expiry stays at the
 * five-minute prerender threshold so a page without a Suspense boundary
 * keeps it in the static shell.
 */
export const failedLookupLifetime = { stale: 30, revalidate: 120, expire: 300 };

export const lookupFailedSnapshot = (): AndroidReleaseSnapshot => ({
  outcome: "lookup-failed",
});

/**
 * Reads a shared release lookup: the release, `None` when there is none, or
 * a failure when the lookup failed, now or within its failure lifetime.
 */
export const readAndroidReleaseSnapshot = (
  operation: string,
  load: () => Promise<AndroidReleaseSnapshot>
): Effect.Effect<Option.Option<AndroidRelease>, MobileReleaseLookupError> =>
  fromSharedSnapshot({ service: "mobile-releases", operation, load }).pipe(
    Effect.mapError(MobileReleaseLookupError.fromCause),
    Effect.flatMap((snapshot) =>
      Match.value(snapshot).pipe(
        Match.discriminatorsExhaustive("outcome")({
          found: ({ release }) => Effect.succeedSome(release),
          none: () => Effect.succeedNone,
          "lookup-failed": () =>
            Effect.fail(
              MobileReleaseLookupError.fromCause(
                "The shared GitHub release lookup failed recently."
              )
            ),
        })
      )
    )
  );
