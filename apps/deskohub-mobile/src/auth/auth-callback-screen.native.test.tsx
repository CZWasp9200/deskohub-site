import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, ManagedRuntime, Option, Semaphore } from "effect";
import { act, type ReactNode } from "react";
import * as ReactNative from "react-native";
import { AppLocaleProvider } from "../i18n/locale-context";
import { clientRoot } from "../testing/client-root";
import { eventually } from "../testing/eventually";
import { Button } from "../ui/controls";
import { EmptyState } from "../ui/empty-state";
import { LoadingIndicator } from "../ui/loading-indicator";
import { find, findAll, flatStyle } from "../ui/testing/element-tree";
import { AuthCallbackCompletions } from "./auth-callback-completions.service";
import { AuthCrypto } from "./auth-crypto.service";
import { AuthSessionBrowser } from "./auth-session-browser.service";
import type { AuthSessionState } from "./auth-session-state";
import { makeMemorySecureStore } from "./memory-secure-store";
import { NativeAuth } from "./native-auth.service";
import { createNativeAuthClient } from "./native-auth-client";
import {
  completeAuthCallback,
  type NativeSignInServices,
  startPendingSignIn,
} from "./native-sign-in";
import { AccountSwitchRefused } from "./native-sign-in-errors";
import { PendingSignIns } from "./pending-sign-in.service";
import { SessionWriteLock } from "./session-write-lock";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import { SignInLocale } from "./sign-in-locale";
import { signInRetryParams } from "./sign-in-retry";
import { type FakeUser, makeFakeAuthServer } from "./testing/fake-auth-server";
import type { AuthTaskRuntime } from "./use-auth-task";

const origin = "https://workspace.deskohub.cz";
const ada: FakeUser = { id: "user-ada", email: testEmailAddress("ada") };
const bob: FakeUser = { id: "user-bob", email: testEmailAddress("bob") };

/** The services the screen's runtime provides; it names the locale itself. */
type ScreenServices = Exclude<NativeSignInServices, SignInLocale>;

/** What the screen runs on and reads; each test sets its own. */
let runtime: AuthTaskRuntime<ScreenServices> | undefined;
let session: AuthSessionState = { status: "signed-out" };
let params: Record<string, string> = {};
let history = true;
const navigation: Array<string> = [];

mock.module("./native-auth-runtime", () => ({
  nativeAuthRuntime: {
    runPromiseExit: (effect: Effect.Effect<unknown, unknown, never>) => {
      if (runtime === undefined) throw new Error("No runtime.");
      return runtime.runPromiseExit(effect as never);
    },
  },
}));
mock.module("./use-auth-session", () => ({
  useAuthSession: () => session,
}));
/**
 * Bun links later test files' imports against the first mock of a module,
 * so the stand-in names everything the app imports from Expo Router; this
 * screen uses only the params and `router`.
 */
const unusedRouterExport = () => {
  throw new Error("Not used by the callback screen.");
};
mock.module("expo-router", () => ({
  Redirect: unusedRouterExport,
  SplashScreen: { hideAsync: unusedRouterExport },
  Stack: unusedRouterExport,
  Tabs: unusedRouterExport,
  // The screen keeps the update banner away while it is focused.
  useFocusEffect: () => undefined,
  useIsFocused: unusedRouterExport,
  useNavigation: unusedRouterExport,
  usePathname: unusedRouterExport,
  usePreventRemove: unusedRouterExport,
  useRoute: unusedRouterExport,
  useRouter: unusedRouterExport,
  useSegments: unusedRouterExport,
  useLocalSearchParams: () => params,
  router: {
    canGoBack: () => history,
    back: () => navigation.push("back"),
    replace: (href: string) => navigation.push(`replace:${href}`),
    dismissTo: (href: unknown) =>
      navigation.push(`dismissTo:${JSON.stringify(href)}`),
  },
}));

const { AuthCallbackScreen } = await import("./auth-callback-screen.native");
const { AuthPhotoSheet } = await import("./auth-photo-sheet");

const { render } = clientRoot({ keepFetch: true });
let launched: Array<{ readonly dispose: () => Promise<void> }> = [];

afterEach(async () => {
  await render(null);
  await Promise.all(launched.map((app) => app.dispose()));
  launched = [];
  runtime = undefined;
  session = { status: "signed-out" };
  params = {};
  history = true;
  navigation.length = 0;
});

/** One app process over the fake server, as the native auth runtime is. */
const launchApp = () => {
  const server = makeFakeAuthServer(origin);
  const store = makeMemorySecureStore();
  const sessionWriteLock = Semaphore.makeUnsafe(1);
  const options = {
    origin,
    storage: store,
    fetch: server.fetch,
    sessionWriteLock,
  };
  const app = ManagedRuntime.make(
    Layer.mergeAll(
      NativeAuth.fromClient(createNativeAuthClient(options), options),
      PendingSignIns.fromStore(store),
      AuthCrypto.Live,
      AuthCallbackCompletions.Default,
      Layer.succeed(AuthSessionBrowser, {
        open: () => Effect.die("The screen opens no auth session."),
        dismiss: Effect.void,
      }),
      Layer.succeed(SessionWriteLock, sessionWriteLock)
    )
  );
  launched.push(app);
  return { server, app };
};

/**
 * The app signed in to Ada, with a reauthentication for her in progress,
 * and the handoff callback the web page returns after Bob signs in there.
 */
const reauthenticationCompletedAsBob = async () => {
  const { server, app } = launchApp();
  await app.runPromise(
    completeAuthCallback({
      kind: "token",
      token: server.issueMagicLink(ada),
    }).pipe(Effect.provideService(SignInLocale, "en-US"))
  );
  const request = await app.runPromise(
    startPendingSignIn(Option.some({ user: ada })).pipe(
      Effect.provideService(SignInLocale, "en-US")
    )
  );
  const callback = new URL(server.mintHandoff(bob, request));
  return {
    runtime: app,
    params: Object.fromEntries(callback.searchParams),
  };
};

/** Draws the screen and returns what it shows last, while it completes. */
const mountScreen = async () => {
  let tree: ReactNode = null;
  const Probe = () => {
    tree = AuthCallbackScreen();
    return null;
  };
  const app = () => (
    <AppLocaleProvider locale="en-US">
      <Probe />
    </AppLocaleProvider>
  );
  await render(app());
  const shown = () => tree;
  /** Draws the same screen again, as a session change would. */
  shown.redraw = () => render(app());
  return shown;
};

/** The props of the screen's loading indicator, if it shows one. */
const indicatorIn = (tree: ReactNode) => find(tree, LoadingIndicator)?.props;

/** Draws the screen and waits until its completion has finished. */
const drawScreen = async () => {
  const tree = await mountScreen();
  const failure = () => find(tree(), EmptyState)?.props;
  // The completion runs on the auth runtime; let it finish and re-render.
  await act(() => Effect.runPromise(eventually(() => failure() !== undefined)));
  return {
    redraw: tree.redraw,
    /** What the failure says happened. */
    cause: () => failure()?.body,
    /** Whether the failure title is announced as soon as it shows. */
    live: () => failure()?.live,
    indicator: () => indicatorIn(tree()),
    buttons: () => findAll(tree(), Button).map(({ props }) => props),
    /** Presses the screen's `index`th button. */
    pressButton: (index = 0) =>
      act(async () => {
        const button = findAll(tree(), Button)[index];
        if (button === undefined) throw new Error("No button.");
        button.props.onPress();
      }),
  };
};

describe("AuthCallbackScreen", () => {
  test("shows a reauthentication that landed on another account as an account switch", async () => {
    const reauthentication = await reauthenticationCompletedAsBob();
    runtime = reauthentication.runtime;
    params = reauthentication.params;
    session = { status: "signed-in", user: ada, signedInAt: new Date() };

    const screen = await drawScreen();

    expect(screen.cause()).toBe(
      nativeSignInFailureMessage(new AccountSwitchRefused(), "en-US")
    );
    expect(screen.live()).toBe("assertive");
    // A signed-in app only goes back: it never starts a new sign-in.
    expect(screen.buttons()).toHaveLength(1);
  });

  test("returns a signed-in app to where it was after a refused callback", async () => {
    const reauthentication = await reauthenticationCompletedAsBob();
    runtime = reauthentication.runtime;
    params = reauthentication.params;
    session = { status: "signed-in", user: ada, signedInAt: new Date() };

    const screen = await drawScreen();
    await screen.pressButton();

    expect(navigation).toEqual(["back"]);
  });

  test("opens the app's home after a refused callback with nothing to go back to", async () => {
    const reauthentication = await reauthenticationCompletedAsBob();
    runtime = reauthentication.runtime;
    params = reauthentication.params;
    session = { status: "signed-in", user: ada, signedInAt: new Date() };
    history = false;

    const screen = await drawScreen();
    await screen.pressButton();

    expect(navigation).toEqual(["replace:/"]);
  });

  test("shows the brand die above its status while the sign-in completes", async () => {
    params = (await reauthenticationCompletedAsBob()).params;
    // The completion never answers, so the screen stays in progress.
    runtime = {
      runPromiseExit: () => new Promise(() => undefined),
    } as unknown as AuthTaskRuntime<ScreenServices>;

    const shown = await mountScreen();

    expect(indicatorIn(shown())).toEqual({ size: "screen", tone: "brand" });
  });

  test("takes the die away once the callback failed", async () => {
    runtime = launchApp().app;
    params = { error: "access_denied" };

    const screen = await drawScreen();

    expect(screen.indicator()).toBeUndefined();
  });

  test("sends a signed-out app back to the sign-in screen after a refused callback", async () => {
    runtime = launchApp().app;
    params = { error: "access_denied" };

    const screen = await drawScreen();
    await screen.pressButton(1);

    expect(navigation).toEqual([`dismissTo:${JSON.stringify("/sign-in")}`]);
  });

  test("uses the wide sheet spacing for a signed-out callback failure", async () => {
    runtime = launchApp().app;
    params = { error: "access_denied" };
    const dimensions = spyOn(
      ReactNative,
      "useWindowDimensions"
    ).mockReturnValue({ width: 1280, height: 800, fontScale: 1, scale: 2 });

    try {
      const tree = await mountScreen();
      const sheet = () => find(tree(), AuthPhotoSheet);
      await act(() =>
        Effect.runPromise(eventually(() => sheet() !== undefined))
      );
      const actions = find(sheet()?.props.children, ReactNative.View);

      expect(flatStyle(actions?.props.style).gap).toBe(12);
      expect(flatStyle(actions?.props.style).marginTop).toBeUndefined();
      expect(findAll(actions, Button)).toHaveLength(2);
    } finally {
      dimensions.mockRestore();
    }
  });

  test("goes on when a sign-in lands though its callback then failed", async () => {
    runtime = launchApp().app;
    params = { error: "access_denied" };
    const screen = await drawScreen();
    expect(navigation).toEqual([]);

    // The session the callback accepted arrives after its account read failed.
    session = { status: "signed-in", user: ada, signedInAt: new Date() };
    await screen.redraw();

    expect(navigation).toEqual(["back"]);
  });

  test("starts a new email sign-in from the sign-in screen after a refused callback", async () => {
    runtime = launchApp().app;
    params = { error: "access_denied" };

    const screen = await drawScreen();
    expect(screen.buttons()[0]?.variant).toBeUndefined();
    await screen.pressButton(0);

    expect(navigation).toEqual([
      `dismissTo:${JSON.stringify({ pathname: "/sign-in", params: signInRetryParams })}`,
    ]);
  });
});
