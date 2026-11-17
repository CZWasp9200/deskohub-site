import { resolveApiOrigin } from "../auth/api-origin";

export type WorkspaceUpdateUrls = {
  readonly latestReleaseUrl: string;
  /** Downloads one version's APK. */
  readonly androidApkUrl: (versionName: string) => string;
};

export const workspaceUpdateUrls = (
  apiOrigin: string
): WorkspaceUpdateUrls => ({
  latestReleaseUrl: `${apiOrigin}/api/mobile/releases/latest`,
  // Redirects to the release's APK on GitHub; the link stays on the
  // Workspace's domain.
  androidApkUrl: (versionName) =>
    `${apiOrigin}/android/download/deskohub-${versionName}.apk`,
});

/**
 * The update URLs on the Workspace this build talks to. Update checks run on
 * native only, so there is no serving origin to fall back to; `app.config.ts`
 * builds the manifest URL from the same variable.
 */
export const configuredWorkspaceUpdateUrls: WorkspaceUpdateUrls =
  workspaceUpdateUrls(
    resolveApiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN, undefined)
  );
