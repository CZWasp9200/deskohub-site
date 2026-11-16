/** What closing the tab needs from the page. */
export interface HandoffTabPage {
  readonly visibilityState: DocumentVisibilityState;
  readonly addEventListener: (
    type: "visibilitychange",
    listener: () => void
  ) => void;
  readonly removeEventListener: (
    type: "visibilitychange",
    listener: () => void
  ) => void;
  readonly close: () => void;
}

/**
 * Closes the browser tab the app opened for its sign-in once the app takes
 * over the screen after the hand-off. Chrome opens that tab in a task of its
 * own, which the app can't close, so without this the back gesture from the
 * app reveals the finished page again.
 */
export const closeTabWhenAppTakesOver = (page: HandoffTabPage): void => {
  const closeOnceHidden = () => {
    if (page.visibilityState !== "hidden") return;
    page.removeEventListener("visibilitychange", closeOnceHidden);
    page.close();
  };
  page.addEventListener("visibilitychange", closeOnceHidden);
};

/** The page this bundle runs in. */
export const currentHandoffTabPage = (): HandoffTabPage => ({
  get visibilityState() {
    return document.visibilityState;
  },
  addEventListener: (type, listener) =>
    document.addEventListener(type, listener),
  removeEventListener: (type, listener) =>
    document.removeEventListener(type, listener),
  close: () => window.close(),
});
