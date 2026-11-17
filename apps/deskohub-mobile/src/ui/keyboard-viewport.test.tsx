import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { clientRoot } from "../testing/client-root";
import {
  useKeyboardResizedViewport,
  type VisibleViewport,
} from "./keyboard-viewport";

const original = "width=device-width, initial-scale=1";

let seen: VisibleViewport | undefined;
function Probe() {
  seen = useKeyboardResizedViewport();
  return null;
}

/** A visual viewport the test moves, as a keyboard or a zoom would. */
class FakeVisualViewport {
  height = 800;
  offsetTop = 0;
  scale = 1;
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: string, listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: () => void) {
    this.listeners.delete(listener);
  }
  move(
    change: Partial<Pick<FakeVisualViewport, "height" | "offsetTop" | "scale">>
  ) {
    Object.assign(this, change);
    for (const listener of this.listeners) listener();
  }
}

const viewportMeta = () =>
  document.querySelector('meta[name="viewport"]')?.getAttribute("content");

describe("useKeyboardResizedViewport", () => {
  const { render } = clientRoot();
  let visual: FakeVisualViewport;

  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", original);
    document.head.append(meta);
    visual = new FakeVisualViewport();
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: visual,
    });
  });
  afterEach(async () => {
    await render(null);
    for (const meta of document.querySelectorAll('meta[name="viewport"]')) {
      meta.remove();
    }
    seen = undefined;
  });

  test("lets the keyboard resize the page only while the screen is shown", async () => {
    await render(<Probe />);
    expect(viewportMeta()).toBe(
      `${original}, interactive-widget=resizes-content`
    );
    await render(null);
    expect(viewportMeta()).toBe(original);
  });

  test("replaces a page's own keyboard setting until the screen goes", async () => {
    const own = `${original}, interactive-widget=overlays-content`;
    document
      .querySelector('meta[name="viewport"]')
      ?.setAttribute("content", own);
    await render(<Probe />);
    expect(viewportMeta()).toBe(
      `${original}, interactive-widget=resizes-content`
    );
    await render(null);
    expect(viewportMeta()).toBe(own);
  });

  test("follows the visible area where only the visual viewport shrinks", async () => {
    await render(<Probe />);
    expect(seen).toEqual({ height: 800, offsetTop: 0 });
    await act(async () => visual.move({ height: 420, offsetTop: 60 }));
    expect(seen).toEqual({ height: 420, offsetTop: 60 });
  });

  test("leaves the page alone while it is zoomed", async () => {
    await render(<Probe />);
    await act(async () => visual.move({ scale: 2, height: 400 }));
    expect(seen).toBeUndefined();
  });
});
