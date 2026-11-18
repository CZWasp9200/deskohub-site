import "server-only";

import { Effect, type Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import type { AndroidRelease } from "../android-release";
import {
  findLatestAndroidRelease,
  type MobileReleaseLookupError,
} from "./android-release-lookup";
import {
  type AndroidReleaseSnapshot,
  failedLookupLifetime,
  lookupFailedSnapshot,
  readAndroidReleaseSnapshot,
  toAndroidReleaseSnapshot,
} from "./android-release-snapshot";

export type { AndroidRelease } from "../android-release";
export { MobileReleaseLookupError } from "./android-release-lookup";

/**
 * The latest Android release from GitHub, shared across requests and server
 * instances. `None` means GitHub has no usable mobile release; a lookup that
 * failed, now or within the last couple of minutes, fails.
 */
export const loadLatestAndroidRelease = (): Effect.Effect<
  Option.Option<AndroidRelease>,
  MobileReleaseLookupError
> =>
  readAndroidReleaseSnapshot("loadLatestAndroidRelease", () =>
    loadSharedLatestAndroidRelease()
  );

/**
 * Unauthenticated GitHub API requests are limited to 60 an hour per IP
 * address, and one lookup takes two to four. Sharing a result for ten
 * minutes keeps refreshes far below that. After that, the result is served
 * while a refresh runs; a refresh that fails replaces it with the failure,
 * so a GitHub outage shows as failed lookups, not as an old release.
 */
const releaseLifetime = { stale: 300, revalidate: 600, expire: 86_400 };

async function loadSharedLatestAndroidRelease(): Promise<AndroidReleaseSnapshot> {
  "use cache: remote";

  return await readSharedSnapshot(
    "mobile-releases.latest-android.load",
    findLatestAndroidRelease().pipe(
      Effect.map(toAndroidReleaseSnapshot),
      Effect.provide(FetchHttpClient.layer)
    ),
    {
      complete: { lifetime: releaseLifetime },
      failure: {
        failureCode: "mobile_releases.latest_android.lookup_failed",
        fallback: lookupFailedSnapshot,
        lifetime: failedLookupLifetime,
      },
    }
  );
}
