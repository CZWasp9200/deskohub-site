import { DefaultTheme, SplashScreen, Stack, ThemeProvider } from "expo-router";
import { useEffect, useState } from "react";
import { AnalyticsRoot } from "../src/analytics/analytics-root";
import { initializeBotProtection } from "../src/auth/bot-protection";
import { SignedInToast } from "../src/auth/signed-in-toast";
import { useAuthSession } from "../src/auth/use-auth-session";
import { useBrandFontReady } from "../src/brand-font";
import { CustomerDataExitCleanup } from "../src/customer-api/customer-data-exit";
import { readLaunchLocale } from "../src/i18n/launch-locale";
import { AppLocaleProvider } from "../src/i18n/locale-context";
import { useSessionLocale } from "../src/i18n/use-session-locale";
import { ToastProvider } from "../src/ui/toast";
import { color } from "../src/ui/tokens";
import { UpdateBanner } from "../src/updates/update-banner";

// The entry (index.ts) has already taken sign-in secrets out of the address
// bar; now load BotID for the sign-in requests (web production only).
initializeBotProtection();
// The splash stays up while the stored session is restored and the brand
// face loads.
void SplashScreen.preventAutoHideAsync();

/**
 * Every navigator draws the brand paper while a screen mounts (such as the
 * start tab deciding where to open), not React Navigation's grey.
 */
const navigationTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: color.paper },
};

export default function RootLayout() {
  const [launchLocale] = useState(readLaunchLocale);
  const session = useAuthSession();
  const { locale, choose } = useSessionLocale(session, launchLocale);
  const brandFontReady = useBrandFontReady();
  const restoring = session.status === "restoring";
  // The navigator mounts once the launch's session restore settles: while the
  // guard is still false a cold-start link to a signed-in route would be
  // replaced by the guard's redirect. Later session re-checks never unmount it.
  const [restored, setRestored] = useState(false);
  if (!restored && !restoring) setRestored(true);
  const ready = brandFontReady && !restoring;

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  // Waiting for the brand face keeps the first screen from flashing the
  // fallback fonts on the web.
  if (!brandFontReady) return null;

  return (
    <AppLocaleProvider locale={locale} choose={choose}>
      <ToastProvider>
        <SignedInToast />
        <AnalyticsRoot>
          <CustomerDataExitCleanup>
            {restored && (
              <ThemeProvider value={navigationTheme}>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="sign-in" />
                  <Stack.Protected guard={session.status === "signed-in"}>
                    <Stack.Screen name="(account)" />
                  </Stack.Protected>
                  {/* Navy under the "Signing you in…" screen, so no light
                    frame shows between it and the sign-in screen. */}
                  <Stack.Screen
                    name="auth/callback"
                    options={{
                      animation: "fade",
                      contentStyle: { backgroundColor: color.navy },
                    }}
                  />
                  <Stack.Screen name="account-deleted" />
                  <Stack.Screen name="dev/effect-smoke" />
                  <Stack.Screen name="dev/design-system" />
                  <Stack.Screen name="dev/booking-components" />
                  <Stack.Screen name="dev/reservations" />
                </Stack>
              </ThemeProvider>
            )}
          </CustomerDataExitCleanup>
        </AnalyticsRoot>
      </ToastProvider>
      <UpdateBanner />
    </AppLocaleProvider>
  );
}
