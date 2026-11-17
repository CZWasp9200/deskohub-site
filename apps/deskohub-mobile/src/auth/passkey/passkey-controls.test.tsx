import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import {
  act,
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { analytics } from "../../analytics/analytics";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { clientRoot } from "../../testing/client-root";
import { Button, LiveMessage } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { find, type HostProps, hostTree } from "../../ui/testing/element-tree";
import { PasskeyCeremonies, type PasskeyCeremonyApi } from "./passkey-ceremony";
import {
  PasskeyCancelled,
  PasskeyNoCredential,
  PasskeyNotSupported,
  PasskeyRejected,
} from "./passkey-failure";

/** The ceremonies the controls run; each test sets the ones it needs. */
let ceremonies: PasskeyCeremonyApi = {
  isSupported: Effect.succeed(true),
  signIn: Effect.void,
  addPasskey: () => Effect.succeed({ id: "synthetic-passkey", name: "Pixel" }),
};

mock.module("./passkey-runtime", () => ({
  passkeyRuntime: ManagedRuntime.make(
    Layer.succeed(PasskeyCeremonies, {
      isSupported: Effect.suspend(() => ceremonies.isSupported),
      signIn: Effect.suspend(() => ceremonies.signIn),
      addPasskey: (input) => Effect.suspend(() => ceremonies.addPasskey(input)),
    })
  ),
}));

const { AddPasskeyAction } = await import("./add-passkey-action");
const { PasskeySignInOption } = await import("./passkey-sign-in-option");

const { render } = clientRoot();

type LiveMessageProps = ComponentProps<typeof LiveMessage>;

/** The `LiveMessage` elements of a tree, in document order. */
const liveMessagesIn = (node: ReactNode): ReadonlyArray<LiveMessageProps> => {
  if (!isValidElement<HostProps>(node)) return [];
  const nested = Children.toArray(node.props.children).flatMap(liveMessagesIn);
  return node.type === LiveMessage
    ? [node.props as unknown as LiveMessageProps, ...nested]
    : nested;
};

/**
 * Runs `component` inside a probe and keeps the tree it returned, so a test
 * can press its button and read its live region. The host components only
 * stand in as names, so the probe draws nothing; it runs each
 * `LiveMessage` in place, so the region's announcement runs as on a device.
 */
const draw = async <Props,>(
  component: (props: Props) => ReactNode,
  props: Props
) => {
  let tree: ReactNode = null;
  let regions: ReadonlyArray<ReactNode> = [];
  const Probe = () => {
    tree = component(props);
    regions = liveMessagesIn(tree).map(LiveMessage);
    return null;
  };
  await render(
    <AppLocaleProvider locale="en-US">
      <Probe />
    </AppLocaleProvider>
  );
  return {
    press: () =>
      act(async () => {
        // The sign-in option draws the design system's button; adding one
        // still draws its own.
        const onPress = (find(tree, Button) ?? find(tree, "Pressable"))?.props
          .onPress;
        if (typeof onPress !== "function") throw new Error("No button.");
        onPress();
      }),
    /** Whether the design system's button shows itself busy. */
    busy: () => find(tree, Button)?.props.busy === true,
    /** The props of the design system's button. */
    button: () => find(tree, Button)?.props,
    /** The props of the control's notice, if it draws one. */
    notice: () => find(tree, Notice)?.props,
    /** The control's live region, as its only `LiveMessage` draws it. */
    region: () => {
      expect(regions).toHaveLength(1);
      return find(hostTree(regions[0]), "Text")?.props;
    },
  };
};

const platform = Platform as { OS: string };
const accessibility = AccessibilityInfo as {
  announceForAccessibilityWithOptions?: (
    message: string,
    options: { readonly queue?: boolean }
  ) => void;
};
const announced: Array<{ message: string; queue: boolean | undefined }> = [];
let os = platform.OS;

beforeEach(() => {
  os = platform.OS;
  announced.length = 0;
  accessibility.announceForAccessibilityWithOptions = (message, options) => {
    announced.push({ message, queue: options.queue });
  };
});
afterEach(async () => {
  await render(null);
  platform.OS = os;
  delete accessibility.announceForAccessibilityWithOptions;
});

const notSupported = () => Effect.fail(new PasskeyNotSupported());
const added = () => Effect.succeed({ id: "synthetic-passkey", name: "Pixel" });

describe("AddPasskeyAction", () => {
  test("starts before the ceremony and settles after its outcome", async () => {
    const steps: Array<string> = [];
    ceremonies = {
      ...ceremonies,
      addPasskey: () =>
        Effect.sync(() => steps.push("ceremony")).pipe(
          Effect.as({ id: "synthetic-passkey", name: "Pixel" })
        ),
    };
    const action = await draw(AddPasskeyAction, {
      kind: "first",
      onStart: () => steps.push("start"),
      onAdded: () => steps.push("added"),
      onSettled: () => steps.push("settled"),
      onReauthenticationRequired: () => steps.push("reauthenticate"),
    });

    await action.press();

    expect(steps).toEqual(["start", "ceremony", "added", "settled"]);
  });

  test("settles after asking for a recent sign-in", async () => {
    const steps: Array<string> = [];
    ceremonies = {
      ...ceremonies,
      addPasskey: () =>
        Effect.fail(
          new PasskeyRejected({ status: 403, code: "SESSION_NOT_FRESH" })
        ),
    };
    const action = await draw(AddPasskeyAction, {
      kind: "first",
      onStart: () => steps.push("start"),
      onSettled: () => steps.push("settled"),
      onReauthenticationRequired: () => steps.push("reauthenticate"),
    });

    await action.press();

    expect(steps).toEqual(["start", "reauthenticate", "settled"]);
  });

  test("a failure shows its cause in an error notice over a primary retry", async () => {
    ceremonies = { ...ceremonies, addPasskey: notSupported };
    const action = await draw(AddPasskeyAction, {
      kind: "another",
      onReauthenticationRequired: () => undefined,
    });
    expect(action.notice()?.message).toBeUndefined();
    expect(action.button()?.variant).toBe("secondary");

    await action.press();

    const notice = action.notice();
    expect(notice?.tone).toBe("error");
    expect(String(notice?.title).length).toBeGreaterThan(0);
    expect(String(notice?.message).length).toBeGreaterThan(0);
    expect(action.button()?.variant).toBe("primary");
    expect(action.button()?.icon).toBe(RotateCcw);
  });

  test("a created passkey leaves no notice; the screen confirms it", async () => {
    ceremonies = { ...ceremonies, addPasskey: added };
    const action = await draw(AddPasskeyAction, {
      kind: "first",
      onReauthenticationRequired: () => undefined,
    });

    await action.press();

    expect(action.notice()?.message).toBeUndefined();
  });
});

describe("PasskeySignInOption", () => {
  test("records the sign-in as started with the passkey method before its ceremony runs", async () => {
    const steps: Array<string> = [];
    const capture = spyOn(analytics, "capture").mockImplementation((event) => {
      steps.push(`${event.name} ${JSON.stringify(event.properties)}`);
    });
    try {
      ceremonies = {
        ...ceremonies,
        signIn: Effect.sync(() => {
          steps.push("ceremony");
        }),
      };
      const option = await draw(PasskeySignInOption, {
        onSignedIn: () => steps.push("signed in"),
      });

      await option.press();

      expect(steps).toEqual([
        'sign-in started {"method":"passkey"}',
        "ceremony",
        "signed in",
      ]);
    } finally {
      capture.mockRestore();
    }
  });

  test("announces a failure assertively on iOS", async () => {
    platform.OS = "ios";
    ceremonies = { ...ceremonies, signIn: notSupported() };
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
    });

    await option.press();

    const message = option.region()?.children;
    expect(typeof message === "string" && message.length > 0).toBe(true);
    expect(option.region()?.role).toBe("alert");
    expect(announced).toEqual([{ message: String(message), queue: false }]);
  });

  test("leaves the announcement to the live region on Android", async () => {
    platform.OS = "android";
    ceremonies = { ...ceremonies, signIn: notSupported() };
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
    });

    await option.press();

    expect(option.region()?.accessibilityLiveRegion).toBe("assertive");
    expect(announced).toEqual([]);
  });
});

describe("a passkey sign-in that used no passkey", () => {
  const idle = ceremonies;
  afterEach(() => {
    ceremonies = idle;
  });

  for (const failure of [new PasskeyCancelled(), new PasskeyNoCredential()]) {
    test(`hands ${failure._tag} to the screen instead of its own alert`, async () => {
      ceremonies = { ...ceremonies, signIn: Effect.fail(failure) };
      const notUsed = mock(() => undefined);
      const option = await draw(PasskeySignInOption, {
        onSignedIn: () => undefined,
        onNotUsed: notUsed,
      });

      await option.press();

      expect(notUsed).toHaveBeenCalledTimes(1);
      expect(option.region()?.children).toBe("");
    });
  }

  test("keeps its own alert for a passkey that didn't work", async () => {
    ceremonies = { ...ceremonies, signIn: notSupported() };
    const notUsed = mock(() => undefined);
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
      onNotUsed: notUsed,
    });

    await option.press();

    expect(notUsed).not.toHaveBeenCalled();
    expect(String(option.region()?.children).length).toBeGreaterThan(0);
  });
});

// The button's busy state and label say it is working, so its die is hidden.
describe("the pending passkey buttons", () => {
  const idle = ceremonies;
  afterEach(() => {
    ceremonies = idle;
  });

  test("adding a passkey shows its button busy while it runs", async () => {
    ceremonies = { ...ceremonies, addPasskey: () => Effect.never };
    const action = await draw(AddPasskeyAction, {
      kind: "first",
      onReauthenticationRequired: () => undefined,
    });
    expect(action.busy()).toBe(false);

    await action.press();

    expect(action.busy()).toBe(true);
  });

  test("signing in with a passkey shows its button busy while it runs", async () => {
    ceremonies = { ...ceremonies, signIn: Effect.never };
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
    });
    expect(option.busy()).toBe(false);

    await option.press();

    expect(option.busy()).toBe(true);
  });
});
