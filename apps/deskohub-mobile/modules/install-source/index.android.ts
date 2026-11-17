import { requireOptionalNativeModule } from "expo";

interface InstallSourceNativeModule {
  getInstallingPackageName(): string | null;
}

/**
 * The package that installed or last updated the app, such as Obtainium or
 * the system package installer, or null when Android records none or the
 * build lacks the module.
 */
export const installingPackageName = (): string | null =>
  requireOptionalNativeModule<InstallSourceNativeModule>(
    "InstallSource"
  )?.getInstallingPackageName() ?? null;
