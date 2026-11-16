import { describe, expect, test } from "bun:test";
import {
  closeTabWhenAppTakesOver,
  type HandoffTabPage,
} from "./close-tab-on-handoff";

/** A page whose visibility a test changes, counting its closes. */
const fakePage = () => {
  let visibility: DocumentVisibilityState = "visible";
  const listeners = new Set<() => void>();
  let closes = 0;
  const page: HandoffTabPage = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    close: () => {
      closes += 1;
    },
  };
  return {
    page,
    become: (next: DocumentVisibilityState) => {
      visibility = next;
      for (const listener of [...listeners]) listener();
    },
    closes: () => closes,
    listening: () => listeners.size,
  };
};

describe("closing the sign-in tab after the hand-off", () => {
  test("keeps the tab while it is still in front", () => {
    const tab = fakePage();
    closeTabWhenAppTakesOver(tab.page);

    tab.become("visible");

    expect(tab.closes()).toBe(0);
  });

  test("closes the tab once, when the app takes over the screen", () => {
    const tab = fakePage();
    closeTabWhenAppTakesOver(tab.page);

    tab.become("hidden");
    tab.become("visible");
    tab.become("hidden");

    expect(tab.closes()).toBe(1);
    expect(tab.listening()).toBe(0);
  });
});
