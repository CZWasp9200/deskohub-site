import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  cloneElement,
  createElement,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { clientRoot } from "../testing/client-root";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";
import type { UpdatePrompt } from "./update-prompt";

// A focused screen runs its focus effect as React runs an effect.
const { useEffect } = await import("react");
mock.module("expo-router", () =>
  expoRouterStandIn({
    useFocusEffect: (effect: () => undefined | (() => void)) =>
      useEffect(effect, [effect]),
  })
);

// One update check's prompt, kept by the hook that calls it until dismissed,
// as `useUpdatePrompt` keeps its own.
const offered: UpdatePrompt = { kind: "ota-update", updateId: "update-1" };
mock.module("./use-update-prompt", () => ({
  useUpdatePrompt: () => {
    const [dismissed, setDismissed] = useState(false);
    return {
      prompt: dismissed ? undefined : offered,
      accept: () => undefined,
      dismiss: () => setDismissed(true),
    };
  },
}));

const { AppLocaleProvider } = await import("../i18n/locale-context");
const { flatStyle } = await import("../ui/testing/element-tree");
const { ToastProvider, useToastObstruction } = await import("../ui/toast");
const { space } = await import("../ui/tokens");
const { UpdateBanner } = await import("./update-banner");
const { UpdateOfferProvider } = await import("./update-offer-provider");
const { useUpdateOfferHost } = await import("./update-offer");
const { QuietUpdateOffer } = await import("./update-offer-card");

type Pressable = ReactElement<{
  readonly onDismiss: () => void;
  readonly onAccept: () => void;
}>;

// The providers run inside probes so their hooks and effects run, while
// only `children` render in their contexts: the host components they return
// stand in as names and aren't drawn.
const Toasts = ({ children }: { readonly children?: ReactNode }) => {
  const tree = ToastProvider({ children }) as ReactElement<{
    children: ReactElement;
  }>;
  return cloneElement(
    tree,
    undefined,
    cloneElement(tree.props.children, undefined, children)
  );
};

let banner: ReactElement<{ style: unknown; children: unknown }> | undefined;
const Banner = () => {
  banner = UpdateBanner() as typeof banner;
  return null;
};
/** The banner's card, or `undefined` while it draws none. */
const bannerCard = () =>
  (banner?.props.children || undefined) as Pressable | undefined;

let quiet: ReactElement<{ children: unknown }> | undefined;
const QuietCard = () => {
  quiet = QuietUpdateOffer({ backdrop: "paper" }) as typeof quiet;
  return null;
};
/** The quiet card, or `undefined` while it draws none. */
const quietCard = () =>
  (quiet?.props.children || undefined) as Pressable | undefined;

const SigningIn = () => {
  useUpdateOfferHost();
  return null;
};

const Obstructing = () => {
  useToastObstruction(80);
  return null;
};

const app = (...screens: ReactElement[]) =>
  createElement(AppLocaleProvider, {
    locale: "en-US",
    children: createElement(
      Toasts,
      null,
      createElement(UpdateOfferProvider, null, ...screens)
    ),
  });

describe("UpdateOfferProvider", () => {
  const { render } = clientRoot();
  afterEach(async () => {
    await render(null);
    banner = undefined;
    quiet = undefined;
  });

  test("the banner sits where toasts do, above a focused layout's bottom chrome", async () => {
    await render(app(createElement(Obstructing), createElement(Banner)));
    expect(bannerCard()).toBeDefined();
    expect(flatStyle(banner?.props.style).paddingBottom).toBe(80 + space.md);
  });

  test("the banner stays away while a focused screen shows the quiet card, and returns after", async () => {
    await render(app(createElement(Banner), createElement(QuietCard)));
    expect(quietCard()).toBeDefined();
    expect(bannerCard()).toBeUndefined();

    await render(app(createElement(Banner)));
    expect(bannerCard()).toBeDefined();
  });

  test("a screen that hosts the offer without drawing it keeps the banner away", async () => {
    await render(app(createElement(Banner), createElement(SigningIn)));
    expect(bannerCard()).toBeUndefined();
  });

  test("an offer dismissed in the quiet card stays dismissed in the banner", async () => {
    await render(app(createElement(Banner), createElement(QuietCard)));
    await act(async () => quietCard()?.props.onDismiss());
    expect(quietCard()).toBeUndefined();

    await render(app(createElement(Banner)));
    expect(bannerCard()).toBeUndefined();
  });

  test("an offer dismissed in the banner stays dismissed in the quiet card", async () => {
    await render(app(createElement(Banner)));
    await act(async () => bannerCard()?.props.onDismiss());
    expect(bannerCard()).toBeUndefined();

    await render(app(createElement(Banner), createElement(QuietCard)));
    expect(quietCard()).toBeUndefined();
  });
});
