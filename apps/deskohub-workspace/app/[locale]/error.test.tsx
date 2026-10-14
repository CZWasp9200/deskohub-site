import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale: "cs-CZ" }),
}));

const routeError = Object.assign(new Error("Server Components render"), {
  digest: "route-error-digest",
});

describe("localized route error boundary", () => {
  describe("in the browser", () => {
    beforeAll(registerWorkspaceComponentTestEnv);
    afterEach(cleanup);
    afterAll(unregisterWorkspaceComponentTestEnv);

    test("retries by re-fetching the segment instead of only resetting it", async () => {
      const { m } = await import("@/features/i18n");
      const { default: ErrorPage } = await import("./error");
      const reset = mock(() => {});
      const retry = mock(() => {});

      const view = render(
        <ErrorPage error={routeError} reset={reset} retry={retry} />
      );
      fireEvent.click(
        view.getByRole("button", {
          name: m.errorPageRetry({}, { locale: "cs-CZ" }),
        })
      );

      expect(retry).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    });
  });
});
