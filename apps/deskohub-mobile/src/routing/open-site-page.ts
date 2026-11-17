import { openBrowserAsync } from "expo-web-browser";
import { color } from "../ui/tokens";

/**
 * The in-app browser tab coloured like the app: the paper canvas with navy
 * controls. Site pages and the payment page open in it.
 */
export const appBrowserTabColors = {
  toolbarColor: color.paper,
  controlsColor: color.navy,
  secondaryToolbarColor: color.paper,
} as const;

/**
 * Opens a site page in the in-app browser tab, coloured like the app, with
 * the page's title above its host in the toolbar (board 16b). It fails where
 * no browser is available.
 */
export const openSitePage = (url: string) =>
  openBrowserAsync(url, { ...appBrowserTabColors, showTitle: true });
