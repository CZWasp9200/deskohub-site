import "server-only";

import { Effect, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import {
  type AndroidRelease,
  mobileReleaseVersionOrder,
} from "../android-release";
import {
  findAndroidRelease,
  type MobileReleaseLookupError,
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
 * shared latest lookup and a version above it has none, so only an older
 * version asks GitHub, once per version across requests and server
 * instances. `None` means the version has no usable release; a lookup that
 * failed, now or within the last couple of minutes, fails.
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
          return readAndroidReleaseSnapshot("loadAndroidRelease", () =>
            loadSharedAndroidRelease(versionName)
          );
        },
      })
    )
  );

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
