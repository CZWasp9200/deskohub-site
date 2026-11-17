import { expect, test } from "bun:test";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import { getWorkspacePageUrl } from "@/features/i18n";
import { androidApkPath, latestAndroidApkPath } from "./android-download";
import { obtainiumImportUrl } from "./obtainium-link";

interface ObtainiumApp {
  readonly id: string;
  readonly url: string;
  readonly author: string;
  readonly name: string;
  /** Obtainium decodes the settings from a JSON string. */
  readonly additionalSettings: string;
}

interface ObtainiumSettings {
  readonly customLinkFilterRegex: string;
  readonly versionExtractionRegEx: string;
  readonly matchGroupToUse: string;
}

const appLinkPrefix = "obtainium://app/";

/** The import payload, read back the way the redirect page and Obtainium do. */
const decodePayload = (href: string): ObtainiumApp => {
  const url = new URL(href);
  const appLink = url.searchParams.get("r") ?? "";
  expect(appLink.startsWith(appLinkPrefix)).toBe(true);
  return JSON.parse(decodeURIComponent(appLink.slice(appLinkPrefix.length)));
};

test("wraps the app link in Obtainium's redirect page", () => {
  const url = new URL(obtainiumImportUrl);

  expect(url.origin).toBe("https://apps.obtainium.imranr.dev");
  expect(url.pathname).toBe("/redirect");
  expect([...url.searchParams.keys()]).toEqual(["r"]);
});

test("imports the app from the locale-agnostic download page", () => {
  const { additionalSettings, ...app } = decodePayload(obtainiumImportUrl);

  expect(app).toEqual({
    id: nativeApp.applicationId,
    url: getWorkspacePageUrl("/android"),
    author: "Deskohub",
    name: "Deskohub",
  });
  expect(app.url).toBe("https://workspace.deskohub.cz/android");
  expect(Object.keys(JSON.parse(additionalSettings))).toEqual([
    "customLinkFilterRegex",
    "versionExtractionRegEx",
    "matchGroupToUse",
  ]);
});

test("finds the APK link and reads its version from the file name", () => {
  const settings: ObtainiumSettings = JSON.parse(
    decodePayload(obtainiumImportUrl).additionalSettings
  );
  const apkUrl = getWorkspacePageUrl(androidApkPath("1.2.3"));
  const linkFilter = new RegExp(settings.customLinkFilterRegex);

  expect(linkFilter.test(apkUrl)).toBe(true);
  expect(linkFilter.test(`${apkUrl}.sha256`)).toBe(false);
  expect(linkFilter.test(getWorkspacePageUrl(latestAndroidApkPath))).toBe(
    false
  );

  const match = new RegExp(settings.versionExtractionRegEx).exec(apkUrl);
  expect(match?.[Number(settings.matchGroupToUse)]).toBe("1.2.3");
});
