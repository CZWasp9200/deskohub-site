package cz.deskohub.installsource

import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Which app installed this one, as Android records it. */
class InstallSourceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InstallSource")

    // The package that installed or last updated the app, or null when
    // Android records none, as after `adb install`.
    Function("getInstallingPackageName") {
      val context = appContext.reactContext ?: return@Function null
      val packageManager = context.packageManager
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          packageManager
            .getInstallSourceInfo(context.packageName)
            .installingPackageName
        } else {
          @Suppress("DEPRECATION")
          packageManager.getInstallerPackageName(context.packageName)
        }
      } catch (error: PackageManager.NameNotFoundException) {
        null
      }
    }
  }
}
