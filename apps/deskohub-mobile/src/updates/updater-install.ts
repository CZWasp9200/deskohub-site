// Apps that install and update other apps themselves, by the package name
// Android records as the installer.
const updaterPackageNames: ReadonlySet<string> = new Set([
  // Obtainium and its F-Droid and debug builds.
  "dev.imranr.obtainium",
  "dev.imranr.obtainium.fdroid",
  "dev.imranr.obtainium.debug",
  // F-Droid clients, and F-Droid's privileged extension, which installs on
  // their behalf.
  "org.fdroid.fdroid",
  "org.fdroid.basic",
  "org.fdroid.fdroid.privileged",
  "com.looker.droidify",
  "com.machiav3lli.fdroid",
  "nya.kitsunyan.foxydroid",
  "eu.bubu1.fdroidclassic",
  // Google Play and the Aurora Store client for it. Obtainium can also
  // install as Google Play or the Galaxy Store.
  "com.android.vending",
  "com.aurora.store",
  "com.sec.android.app.samsungapps",
]);

/**
 * Whether an app store or updater installed the app, so it offers new APKs
 * itself. `installingPackageName` is the installer Android records; a browser
 * or file manager download installs through the system package installer,
 * and `adb install` records none.
 */
export const installedByUpdater = (
  installingPackageName: string | null
): boolean =>
  installingPackageName !== null &&
  updaterPackageNames.has(installingPackageName);
