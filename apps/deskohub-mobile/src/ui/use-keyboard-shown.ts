import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Whether the on-screen keyboard is up, for a sticky footer that keeps only
 * its button above the keyboard.
 */
export const useKeyboardShown = (): boolean => {
  const [shown, setShown] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener("keyboardDidShow", () => setShown(true)),
      Keyboard.addListener("keyboardDidHide", () => setShown(false)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return shown;
};

/**
 * How tall the on-screen keyboard is while it's up, else 0, for an overlay
 * that stays above it, such as a bottom sheet with a search field. iOS
 * reports the keyboard as it starts to move; Android once it has.
 */
export const useKeyboardHeight = (): number => {
  const [height, setHeight] = useState(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0
  );
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const subscriptions = [
      Keyboard.addListener(
        ios ? "keyboardWillShow" : "keyboardDidShow",
        ({ endCoordinates }) => setHeight(endCoordinates.height)
      ),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
        setHeight(0)
      ),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return height;
};
