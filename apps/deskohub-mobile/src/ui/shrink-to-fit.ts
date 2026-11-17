import { Platform } from "react-native";

/**
 * Text props for a short label that must never be cut or split mid-word: at
 * large font sizes it shrinks to fit one line natively, and wraps on the
 * web, which can't shrink text to fit.
 */
export const shrinkToFitLine =
  Platform.OS === "web"
    ? {}
    : ({
        numberOfLines: 1,
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.5,
      } as const);
