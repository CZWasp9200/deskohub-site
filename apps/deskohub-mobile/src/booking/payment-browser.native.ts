import type { Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { Platform } from "react-native";
import { appBrowserTabColors } from "../routing/open-site-page";
import { PaymentBrowser } from "./payment-browser.service";

/**
 * Opens the gateway's Custom Tab in the app's own task, coloured like the
 * app. With Expo's default (`createTask: true`), Android keeps the tab in a
 * separate task, and the next payment brings that task back with the
 * previous order's page instead of the new one, as it did for sign-in
 * (#1039).
 */
const authSessionOptions: WebBrowser.AuthSessionOpenOptions = {
  ...appBrowserTabColors,
  createTask: false,
};

/**
 * The payment page on Android and iOS: Expo's auth session, which closes
 * when the gateway redirects to the app's return URL.
 */
export const paymentBrowserLayer: Layer.Layer<PaymentBrowser> =
  PaymentBrowser.fromAuthSession((url, redirectUrl) =>
    WebBrowser.openAuthSessionAsync(url, redirectUrl, authSessionOptions)
  );

/**
 * Starts Android's Custom Tabs browser while the customer reviews, so the
 * payment page's tab comes up sooner, and lets it go when the screen does.
 * Only Android has the warm-up.
 */
export const usePaymentBrowserWarmUp = () => {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    WebBrowser.warmUpAsync().catch(() => undefined);
    return () => {
      WebBrowser.coolDownAsync().catch(() => undefined);
    };
  }, []);
};
