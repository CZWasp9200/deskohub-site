import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountSectionPanel } from "./account-section-panel";

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("keeps the standard size unless a screen opts into the compact panel", () => {
  const view = render(
    <>
      <AccountSectionPanel title="Profile">Body</AccountSectionPanel>
      <AccountSectionPanel size="compact" title="Referrals">
        Body
      </AccountSectionPanel>
    </>
  );
  const [standard, compact] = view.getAllByRole("region");
  const titleClasses = (panel: HTMLElement | undefined) =>
    panel?.querySelector("h2")?.className ?? "";

  expect(standard?.getAttribute("data-size")).toBe("default");
  expect(titleClasses(standard)).toContain("text-[26px]");
  expect(compact?.getAttribute("data-size")).toBe("compact");
  expect(titleClasses(compact)).toContain("text-xl");
  expect(titleClasses(compact)).not.toContain("text-[26px]");
});
