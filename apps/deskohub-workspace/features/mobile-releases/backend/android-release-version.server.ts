import "server-only";

import { Effect, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  fromSharedSnapshot,
  readSharedSnapshot,
} from "@/shared/backend/shared-snapshot";
import {
  type AndroidRelease,
  mobileReleaseVersionOrder,
} from "../android-release";
import {
  findAndroidRelease,
  findMobileReleaseVersions,
  MobileReleaseLookupError,
} from "./android-release-lookup";
import {
  type AndroidReleaseSnapshot,
  failedLookupLifetime,
  lookupFailedSnapshot,
  readAndroidReleaseSnapshot,
  toAndroidReleaseSnapshot,
} from "./android-release-snapshot";
import { loadLatestAndroidRelease } from "./latest-android-release.server";

/**
 * The Android release of one version. The latest release answers from the
 * shared latest lookup, and a version above it or without a `mobile-v` tag
 * has none, so only an older tagged version asks GitHub for its release,
 * once per version across requests and server instances. Made-up version
 * names therefore never spend the GitHub API's hourly limit. `None` means
 * the version has no usable release; a lookup that failed, now or within the
 * last couple of minutes, fails.
 */
export const loadAndroidRelease = (
  versionName: string
): Effect.Effect<Option.Option<AndroidRelease>, MobileReleaseLookupError> =>
  loadLatestAndroidRelease().pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (latest) => {
          const order = mobileReleaseVersionOrder(
            versionName,
            latest.versionName
          );
          if (order === 0) return Effect.succeedSome(latest);
          if (order > 0) return Effect.succeedNone;
          return loadMobileReleaseVersions.pipe(
            Effect.flatMap((versions) =>
              versions.includes(versionName)
                ? readAndroidReleaseSnapshot("loadAndroidRelease", () =>
                    loadSharedAndroidRelease(versionName)
                  )
                : Effect.succeedNone
            )
          );
        },
      })
    )
  );

/**
 * What one shared tag lookup found. A plain object because the cache
 * serializes it.
 */
type MobileReleaseVersionsSnapshot =
  | { readonly outcome: "found"; readonly versions: ReadonlyArray<string> }
  | { readonly outcome: "lookup-failed" };

const loadMobileReleaseVersions = fromSharedSnapshot({
  service: "mobile-releases",
  operation: "loadMobileReleaseVersions",
  load: () => loadSharedMobileReleaseVersions(),
}).pipe(
  Effect.mapError(MobileReleaseLookupError.fromCause),
  Effect.flatMap((snapshot) =>
    snapshot.outcome === "found"
      ? Effect.succeed(snapshot.versions)
      : Effect.fail(
          MobileReleaseLookupError.fromCause(
            "The shared GitHub tag lookup failed recently."
          )
        )
  )
);

/** Tags change as often as the latest release, so they share its lifetime. */
const tagLifetime = { stale: 300, revalidate: 600, expire: 86_400 };

async function loadSharedMobileReleaseVersions(): Promise<MobileReleaseVersionsSnapshot> {
  "use cache: remote";

  return await readSharedSnapshot(
    "mobile-releases.release-versions.load",
    findMobileReleaseVersions().pipe(
      Effect.map(
        (versions): MobileReleaseVersionsSnapshot => ({
          outcome: "found",
          versions,
        })
      ),
      Effect.provide(FetchHttpClient.layer)
    ),
    {
      complete: { lifetime: tagLifetime },
      failure: {
        failureCode: "mobile_releases.release_versions.lookup_failed",
        fallback: (): MobileReleaseVersionsSnapshot => ({
          outcome: "lookup-failed",
        }),
        lifetime: failedLookupLifetime,
      },
    }
  );
}

/**
 * A published release never changes, so a found one is shared for a day. A
 * version without one is rechecked as often as the latest release, in case
 * its release is published late.
 */
const releaseLifetime = { stale: 3600, revalidate: 86_400, expire: 604_800 };
const missingReleaseLifetime = { stale: 300, revalidate: 600, expire: 86_400 };

async function loadSharedAndroidRelease(
  versionName: string
): Promise<AndroidReleaseSnapshot> {
  "use cache: remote";

  return await readSharedSnapshot(
    "mobile-releases.android-release.load",
    findAndroidRelease(versionName).pipe(
      Effect.map(toAndroidReleaseSnapshot),
      Effect.provide(FetchHttpClient.layer)
    ),
    {
      complete: { lifetime: releaseLifetime },
      incomplete: {
        when: (snapshot) => snapshot.outcome === "none",
        lifetime: missingReleaseLifetime,
      },
      failure: {
        failureCode: "mobile_releases.android_release.lookup_failed",
        fallback: lookupFailedSnapshot,
        lifetime: failedLookupLifetime,
      },
    }
  );
}
