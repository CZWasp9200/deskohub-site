import { Effect } from "effect";
import { redirectToLatestAndroidApk } from "@/features/mobile-releases/backend/android-apk-download-response";
import { AndroidReleases } from "@/features/mobile-releases/backend/android-releases.service";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

/** The latest Android APK, on the site's own domain. */
export const GET = defineWorkspaceRoute(
  {
    operation: "mobileLatestAndroidApk",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (_request: Request) =>
    redirectToLatestAndroidApk.pipe(Effect.provide(AndroidReleases.Default))
);
