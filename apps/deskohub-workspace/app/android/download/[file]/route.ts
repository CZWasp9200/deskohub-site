import { Effect } from "effect";
import { redirectToAndroidApk } from "@/features/mobile-releases/backend/android-apk-download-response";
import { AndroidReleases } from "@/features/mobile-releases/backend/android-releases.service";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

type AndroidApkRouteContext = {
  readonly params: Promise<{ readonly file: string }>;
};

/**
 * One release's APK as `deskohub-X.Y.Z.apk`, on the site's own domain.
 * Obtainium picks this link on `/android` and reads the version from the
 * file name.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "mobileAndroidApk",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (_request: Request, { params }: AndroidApkRouteContext) =>
    Effect.promise(() => params).pipe(
      Effect.flatMap(({ file }) => redirectToAndroidApk(file)),
      Effect.provide(AndroidReleases.Default)
    )
);
