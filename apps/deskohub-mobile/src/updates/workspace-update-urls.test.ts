import { expect, test } from "bun:test";
import { workspaceUpdateUrls } from "./workspace-update-urls";

test("builds the release lookup and the APK download on the API origin", () => {
  const urls = workspaceUpdateUrls("https://workspace.test");

  expect(urls.latestReleaseUrl).toBe(
    "https://workspace.test/api/mobile/releases/latest"
  );
  expect(urls.androidApkUrl("1.2.3")).toBe(
    "https://workspace.test/android/download/deskohub-1.2.3.apk"
  );
});
