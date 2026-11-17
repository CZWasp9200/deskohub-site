import { Effect, Option } from "effect";
import { type AndroidRelease, androidApkVersion } from "../android-release";
import type { MobileReleaseLookupError } from "./android-release-lookup";
import { AndroidReleases } from "./android-releases.service";
import { sharedCaching } from "./latest-android-release-response";

// A published release never changes, so the edge may keep its redirect for a
// day. Which release is the latest changes, so that redirect follows the
// latest lookup's caching.
const releaseCaching = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
};

/**
 * Sends a download of the latest APK to its file on GitHub, so the site
 * links the APK on its own domain.
 */
export const redirectToLatestAndroidApk = Effect.gen(function* () {
  const releases = yield* AndroidReleases;
  return yield* redirectToApk(releases.latest, sharedCaching);
});

/**
 * Sends a download of `deskohub-X.Y.Z.apk` to that release's APK on GitHub.
 * A file name no release could publish, or a version without a usable
 * release, answers 404.
 */
export const redirectToAndroidApk = Effect.fn(
  "MobileReleases.redirectToAndroidApk"
)(function* (fileName: string) {
  const releases = yield* AndroidReleases;
  return yield* redirectToApk(
    Option.match(androidApkVersion(fileName), {
      onNone: () => Effect.succeedNone,
      onSome: releases.release,
    }),
    releaseCaching
  );
});

const redirectToApk = (
  lookup: Effect.Effect<
    Option.Option<AndroidRelease>,
    MobileReleaseLookupError
  >,
  caching: Record<string, string>
) =>
  lookup.pipe(
    Effect.map(
      Option.match({
        onSome: (release) =>
          new Response(null, {
            status: 302,
            headers: { Location: release.apkUrl, ...caching },
          }),
        onNone: () =>
          Response.json(
            { error: "no-release" },
            { status: 404, headers: sharedCaching }
          ),
      })
    ),
    // The shared lookup already logged the failure with its cause.
    Effect.catchTag("MobileReleaseLookupError", (failure) =>
      Effect.logWarning("Android APK release lookup failed", {
        cause: failure.cause,
      }).pipe(
        Effect.as(
          Response.json(
            { error: "lookup-failed" },
            { status: 502, headers: { "Cache-Control": "no-store" } }
          )
        )
      )
    )
  );
