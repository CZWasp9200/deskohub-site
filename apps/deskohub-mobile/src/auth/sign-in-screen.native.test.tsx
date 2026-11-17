import { afterEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";
import { act, type ReactNode } from "react";
import { AppLocaleProvider } from "../i18n/locale-context";
import { clientRoot } from "../testing/client-root";
import { eventually } from "../testing/eventually";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";
import { Button } from "../ui/controls";
import { Notice } from "../ui/notice";
import { find } from "../ui/testing/element-tree";
import type { AuthSessionState } from "./auth-session-state";
import {
  type NativeSignInFailure,
  SignInCancelled,
  SignInLinkRefused,
} from "./native-sign-in-errors";
import { signInRetryParams } from "./sign-in-retry";

/** How each email attempt ends; each test sets its own. */
let attempt: () => Promise<Exit.Exit<unknown, NativeSignInFailure>> = () =>
  new Promise(() => undefined);
let attempts = 0;
let params: Record<string, string> = {};
const paramChanges: Array<Record<string, unknown>> = [];
const session: AuthSessionState = { status: "signed-out" };

mock.module("./native-auth-runtime", () => ({
  nativeAuthRuntime: {
    runPromiseExit: () => {
      attempts += 1;
      return attempt();
    },
  },
}));
mock.module("./use-auth-session", () => ({
  useAuthSession: () => session,
}));
mock.module("expo-router", () => ({
  ...expoRouterStandIn({ useLocalSearchParams: () => params }),
  router: {
    setParams: (next: Record<string, unknown>) => {
      paramChanges.push(next);
      params = {};
    },
  },
}));

const { SignInScreen } = await import("./sign-in-screen.native");

const { render } = clientRoot();

afterEach(async () => {
  await render(null);
  attempt = () => new Promise(() => undefined);
  attempts = 0;
  params = {};
  paramChanges.length = 0;
});

type PasskeyOption = Parameters<
  NonNullable<Parameters<typeof SignInScreen>[0]["passkeyOption"]>
>[0];

/** Draws the screen and keeps what it returned last and its passkey option. */
const drawScreen = async () => {
  let tree: ReactNode = null;
  let passkey: PasskeyOption | undefined;
  const Probe = () => {
    tree = SignInScreen({
      passkeyOption: (option) => {
        passkey = option;
        return null;
      },
    });
    return null;
  };
  await render(
    <AppLocaleProvider locale="en-US">
      <Probe />
    </AppLocaleProvider>
  );
  return {
    notice: () => find(tree, Notice)?.props,
    email: () => find(tree, Button)?.props,
    passkey: () => {
      if (passkey === undefined) throw new Error("No passkey option.");
      return passkey;
    },
    settle: (done: () => boolean) =>
      act(() => Effect.runPromise(eventually(done))),
  };
};

describe("SignInScreen", () => {
  test("starts with no note", async () => {
    const screen = await drawScreen();

    expect(screen.notice()?.message).toBeUndefined();
  });

  test("notes calmly that a closed browser tab cancelled the sign-in", async () => {
    attempt = async () => Exit.fail(new SignInCancelled());
    const screen = await drawScreen();

    await act(async () => screen.email()?.onPress());
    await screen.settle(() => screen.notice()?.message !== undefined);

    expect(screen.notice()?.tone).toBe("info");
  });

  test("says what went wrong when the sign-in failed", async () => {
    attempt = async () =>
      Exit.fail(new SignInLinkRefused({ reason: "expired" }));
    const screen = await drawScreen();

    await act(async () => screen.email()?.onPress());
    await screen.settle(() => screen.notice()?.message !== undefined);

    expect(screen.notice()?.tone).toBe("error");
  });

  test("shows the email button busy while the browser tab is open", async () => {
    const screen = await drawScreen();

    await act(async () => screen.email()?.onPress());

    expect(screen.email()?.busy).toBe(true);
    expect(screen.passkey().disabled).toBe(true);
  });

  test("notes an unused passkey, until the next attempt starts", async () => {
    const screen = await drawScreen();

    await act(async () => screen.passkey().onNotUsed?.());
    expect(screen.notice()?.tone).toBe("info");
    expect(screen.notice()?.message).toBeDefined();

    await act(async () => screen.passkey().onPendingChange(true));
    expect(screen.notice()?.message).toBeUndefined();
  });

  test("starts one new email sign-in when opened to start again", async () => {
    params = { ...signInRetryParams };
    const screen = await drawScreen();

    await screen.settle(() => attempts > 0);

    expect(attempts).toBe(1);
    expect(paramChanges).toEqual([{ start: undefined }]);
    expect(screen.email()?.busy).toBe(true);
  });
});
