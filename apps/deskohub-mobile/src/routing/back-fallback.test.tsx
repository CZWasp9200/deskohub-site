import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createElement } from "react";
import { BackHandler } from "react-native";
import { clientRoot } from "../testing/client-root";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

const replaced: unknown[] = [];
let focused = true;
mock.module("expo-router", () =>
  expoRouterStandIn({
    useIsFocused: () => focused,
    useRouter: () => ({
      push: (_href: unknown) => undefined,
      replace: (href: unknown) => replaced.push(href),
    }),
  })
);

const { useBackFallback } = await import("./back-fallback");

const root = clientRoot();

/** The hardware-back listeners registered and not yet removed. */
const listeners = () => {
  const registered = new Set<() => boolean>();
  spyOn(BackHandler, "addEventListener").mockImplementation(((
    _event: string,
    listener: () => boolean
  ) => {
    registered.add(listener);
    return { remove: () => registered.delete(listener) };
  }) as never);
  return registered;
};

const Screen = ({
  canGoBack,
  fallback,
}: {
  readonly canGoBack: boolean;
  readonly fallback: "/reservations" | undefined;
}) => {
  useBackFallback({ canGoBack: () => canGoBack }, fallback);
  return null;
};

const pressBack = (registered: ReadonlySet<() => boolean>) =>
  [...registered].map((listener) => listener());

afterEach(() => {
  replaced.length = 0;
  focused = true;
});

describe("useBackFallback", () => {
  test("Android back on a screen with nothing behind it opens the fallback", async () => {
    const registered = listeners();
    await root.render(
      createElement(Screen, { canGoBack: false, fallback: "/reservations" })
    );
    expect(pressBack(registered)).toEqual([true]);
    expect(replaced).toEqual(["/reservations"]);
  });

  test("with a screen behind it, the navigator goes back as usual", async () => {
    const registered = listeners();
    await root.render(
      createElement(Screen, { canGoBack: true, fallback: "/reservations" })
    );
    expect(pressBack(registered)).toEqual([false]);
    expect(replaced).toEqual([]);
  });

  test("without a fallback or focus, it leaves back alone", async () => {
    const registered = listeners();
    await root.render(
      createElement(Screen, { canGoBack: false, fallback: undefined })
    );
    expect(pressBack(registered)).toEqual([]);
    focused = false;
    await root.render(
      createElement(Screen, { canGoBack: false, fallback: "/reservations" })
    );
    expect(pressBack(registered)).toEqual([]);
  });
});
