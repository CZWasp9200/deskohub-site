import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

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
