import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { SignInLoading } from "./sign-in-loading";

describe("SignInLoading", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  afterEach(cleanup);
  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each(["en-US", "cs-CZ"] as const)(
    "renders the visible localized fallback for %s",
    (locale) => {
      const view = render(<SignInLoading locale={locale} />);
      const main = view.getByRole("main");
      const status = view.getByRole("status", {
        name: m.accountSignInLoading({}, { locale }),
      });

      expect(status).toBeTruthy();
      expect(status.getAttribute("aria-busy")).toBe("true");
      expect(status.getAttribute("data-slot")).toBe("sign-in-loading");
      expect(status.getAttribute("hidden")).toBeNull();
      expect(status.getAttribute("aria-hidden")).toBeNull();
      expect(main.getAttribute("role")).toBeNull();
      expect(status.querySelector('[data-slot="skeleton"]')).toBeTruthy();
      expect(view.container.querySelector("form")).toBeNull();
      expect(view.queryByRole("textbox")).toBeNull();
      expect(status.textContent).toBe("");
      expect(view.container.querySelector("[value]")).toBeNull();
      expect(view.container.textContent).not.toContain("@");
    }
  );
});
