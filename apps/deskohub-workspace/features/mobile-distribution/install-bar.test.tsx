import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { InstallEnvironment } from "./install-environment";

const iphoneSafari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

const iosEnvironment: InstallEnvironment = {
  platform: "ios",
  standalone: false,
  androidAppInstalled: undefined,
  installPromptAvailable: false,
  installPromptSupported: false,
  webAppInstalled: false,
};

mock.module("next/image", () => ({
  // Bun resolves static image imports to their file path.
  default: ({ alt, src }: { readonly alt: string; readonly src: string }) => (
    // biome-ignore lint/performance/noImgElement: stands in for next/image.
    <img alt={alt} src={src} />
  ),
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/en-US/account",
}));
mock.module("@/features/cookie-consent", () => ({
  useVisitorConsentAnswered: () => true,
}));
mock.module("./use-install-environment", () => ({
  useInstallEnvironment: () => iosEnvironment,
  promptWebAppInstall: () => undefined,
}));

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => iphoneSafari,
  });
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const renderBar = async () => {
  const { InstallBar } = await import("./install-bar");
  const view = render(<InstallBar locale="en-US" placement="page" />);
  await flushWorkspaceComponentWork();
  const bar = view.getByRole("region");
  const [install] = Array.from(bar.querySelectorAll("button"));
  if (!install) throw new Error("the bar has no Install button");
  return { view, bar, install };
};

const settle = async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await flushWorkspaceComponentWork();
};

describe("InstallBar with the add-to-Home-Screen guide", () => {
  test("steps out of sight and reach while the guide is open", async () => {
    const { view, bar, install } = await renderBar();
    expect(bar.hasAttribute("inert")).toBe(false);

    fireEvent.click(install);
    await settle();

    expect(view.getByRole("dialog")).toBeTruthy();
    expect(bar.hasAttribute("inert")).toBe(true);
    expect(bar.className).toContain("invisible");
  });

  test("comes back with focus on Install when the guide closes", async () => {
    const { view, bar, install } = await renderBar();
    fireEvent.click(install);
    await settle();

    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    await settle();

    expect(view.queryByRole("dialog")).toBeNull();
    expect(bar.hasAttribute("inert")).toBe(false);
    expect(bar.className).not.toContain("invisible");
    expect(document.activeElement).toBe(install);
  });

  test("shows numbered pictures without a button besides close", async () => {
    const { view, install } = await renderBar();
    fireEvent.click(install);
    await settle();

    const dialog = view.getByRole("dialog");
    expect(dialog.querySelectorAll("ol > li").length).toBe(3);
    expect(dialog.querySelectorAll("button").length).toBe(1);
  });
});
