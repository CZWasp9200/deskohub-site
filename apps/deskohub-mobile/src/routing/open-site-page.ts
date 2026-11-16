import { openBrowserAsync } from "expo-web-browser";
import { color } from "../ui/tokens";

/**
 * Opens a site page in the in-app browser tab, coloured like the app: the
 * paper canvas with navy controls. It fails where no browser is available.
 */
export const openSitePage = (url: string) =>
  openBrowserAsync(url, {
    toolbarColor: color.paper,
    controlsColor: color.navy,
    secondaryToolbarColor: color.paper,
  });
