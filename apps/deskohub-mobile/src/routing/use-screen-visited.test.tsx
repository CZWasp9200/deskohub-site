import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { clientRoot } from "../testing/client-root";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

let focused = false;
mock.module("expo-router", () =>
  expoRouterStandIn({ useIsFocused: () => focused })
);

const { useScreenVisited } = await import("./use-screen-visited");

const { render } = clientRoot();

describe("useScreenVisited", () => {
  test("stays false until the screen first has focus, then stays true", async () => {
    const seen: boolean[] = [];
    function Probe({ step }: { readonly step: number }) {
      seen.push(useScreenVisited());
      return createElement("span", { "data-step": step });
    }

    focused = false;
    await render(createElement(Probe, { step: 0 }));
    expect(seen.at(-1)).toBe(false);

    focused = true;
    await render(createElement(Probe, { step: 1 }));
    expect(seen.at(-1)).toBe(true);

    // Another tab in front again: the screen keeps its content.
    focused = false;
    await render(createElement(Probe, { step: 2 }));
    expect(seen.at(-1)).toBe(true);
  });

  test("a screen that mounts in front is visited at once", async () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useScreenVisited());
      return null;
    }

    focused = true;
    await render(createElement(Probe));
    expect(seen[0]).toBe(true);
  });
});
