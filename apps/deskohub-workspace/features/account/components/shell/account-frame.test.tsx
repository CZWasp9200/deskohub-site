import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountFrame, type AccountFrameProps } from "./account-frame";

function makeProps(
  overrides: Partial<AccountFrameProps> = {}
): AccountFrameProps {
  return {
    children: <div data-testid="content">Account content</div>,
    navigation: (
      <nav className="caller-owned-navigation" data-testid="navigation">
        Account navigation
      </nav>
    ),
    sidebarFooter: <p data-testid="sidebar-footer">Sidebar footer</p>,
    signOut: (
      <button type="button" data-testid="sign-out">
        Sign out
      </button>
    ),
    title: "Workspace account",
    ...overrides,
  };
}

function renderFrame(overrides: Partial<AccountFrameProps> = {}) {
  return render(<AccountFrame {...makeProps(overrides)} />);
}

describe("AccountFrame", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(cleanup);

  afterAll(unregisterWorkspaceComponentTestEnv);

  test("keeps the title, action, navigation, footer, and content slots ordered", () => {
    const view = renderFrame();
    const main = view.container.querySelector("main");
    if (!main) throw new Error("Account frame main was not rendered");
    const content = main.querySelector(":scope > div");
    if (!content)
      throw new Error("Account frame content wrapper was not rendered");
    const header = content.querySelector(":scope > header");
    if (!header) throw new Error("Account frame header was not rendered");
    const grid = content.querySelector(":scope > div");
    if (!grid) throw new Error("Account frame grid was not rendered");
    const aside = grid.querySelector(":scope > aside");
    if (!aside) throw new Error("Account frame aside was not rendered");
    const contentSlot = grid.children.item(1);
    if (!contentSlot)
      throw new Error("Account frame content slot was not rendered");
    const mobileFooter = grid.children.item(2);
    if (!mobileFooter)
      throw new Error("Account frame mobile footer was not rendered");

    const title = view.getByRole("heading", {
      level: 1,
      name: "Workspace account",
    });
    const navigation = view.getByTestId("navigation");
    const footers = view.getAllByTestId("sidebar-footer");
    expect(footers).toHaveLength(2);
    const [desktopFooter, mobileFooterContent] = footers;
    const signOut = view.getByTestId("sign-out");

    expect(header.children).toHaveLength(2);
    expect(header.firstElementChild).toBe(title);
    expect(header.lastElementChild).toBe(signOut.parentElement);
    expect(aside.children).toHaveLength(2);
    expect(aside.firstElementChild).toBe(navigation);
    expect(aside.lastElementChild).toBe(desktopFooter.parentElement);
    expect(grid.children).toHaveLength(3);
    expect(grid.firstElementChild).toBe(aside);
    expect(grid.children.item(1)).toBe(contentSlot);
    expect(grid.lastElementChild).toBe(mobileFooter);
    expect(contentSlot.contains(view.getByTestId("content"))).toBe(true);
    expect(navigation.parentElement).toBe(aside);
    expect(mobileFooter.contains(mobileFooterContent)).toBe(true);
    expect(mobileFooterContent).not.toBe(desktopFooter);
    expect(navigation.className).toBe("caller-owned-navigation");
  });

  test("omits optional sign-out and sidebar footer slots without wrappers", () => {
    const view = renderFrame({ signOut: undefined, sidebarFooter: undefined });
    const header = view.container.querySelector("header");
    if (!header) throw new Error("Account frame header was not rendered");
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account frame aside was not rendered");

    expect(header.children).toHaveLength(1);
    expect(aside.children).toHaveLength(1);
    expect(view.queryByTestId("sign-out")).toBeNull();
    expect(view.queryByTestId("sidebar-footer")).toBeNull();
    expect(view.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(view.getByTestId("navigation").parentElement).toBe(aside);
  });
});
