import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { DeferredTagManager } from "./deferred-tag-manager";

const tagManagerScripts = () =>
  Array.from(document.querySelectorAll("script")).filter((script) =>
    script.src.includes("googletagmanager.com/gtm.js")
  );

// happy-dom never fetches scripts; report the container as loaded quietly.
beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
});
afterEach(() => {
  cleanup();
  for (const script of tagManagerScripts()) script.remove();
});
afterAll(unregisterWorkspaceComponentTestEnv);

test("server rendering emits no Tag Manager markup or request", () => {
  const html = renderToString(<DeferredTagManager gtmId="GTM-TEST123" />);

  expect(html).toBe("");
  expect(html).not.toContain("googletagmanager");
  expect(tagManagerScripts()).toHaveLength(0);
});

test("mounting defers the container until the first interaction", () => {
  render(
    <StrictMode>
      <DeferredTagManager gtmId="GTM-TEST123" />
    </StrictMode>
  );
  expect(tagManagerScripts()).toHaveLength(0);

  window.dispatchEvent(new Event("pointerdown"));
  expect(tagManagerScripts()).toHaveLength(1);
});
