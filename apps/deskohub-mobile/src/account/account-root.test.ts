import { describe, expect, mock, test } from "bun:test";
import type { Href, ImperativeRouter } from "expo-router";
import { createElement, useEffect } from "react";
import { clientRoot } from "../testing/client-root";
import {
  accountRootHref,
  returnToAccountRoot,
  useDefaultAccountProfile,
} from "./account-root";

describe("returnToAccountRoot", () => {
  const recordingRouter = () => {
    type Options = Parameters<ImperativeRouter["dismissTo"]>[1];
    const calls: Array<readonly [string, Href, Options]> = [];
    const record =
      (method: string) =>
      (href: Href, options?: Options): void =>
        void calls.push([method, href, options]);
    return {
      calls,
      router: {
        dismissTo: record("dismissTo"),
        replace: record("replace"),
        push: record("push"),
        navigate: record("navigate"),
      },
    };
  };

  test("goes back down the Account stack to its root, not onto a second root", () => {
    const { calls, router } = recordingRouter();
    returnToAccountRoot(router);
    // A replace would swap the section for a second Account root above the
    // anchored one, which then shows a back arrow to itself (#1125).
    expect(calls).toEqual([["dismissTo", "/account", undefined]]);
  });

  test("the Account root is the Account tab's index", () => {
    expect(accountRootHref).toBe("/account");
  });
});

describe("the expanded Account default detail", () => {
  const { render } = clientRoot();

  const mountedOverview = () => {
    const navigate = mock((_href: Href) => undefined);
    const router = { navigate };
    type Overview = Parameters<typeof useDefaultAccountProfile>[1] & {
      readonly linked: boolean;
    };
    function Overview({ linked, ...route }: Overview) {
      const open = useDefaultAccountProfile(router, route);
      useEffect(() => {
        if (linked) open();
      }, [linked, open]);
      return null;
    }
    return {
      navigate,
      show: (route: Partial<Overview> = {}) =>
        render(
          createElement(Overview, {
            linked: true,
            focused: true,
            isExpanded: true,
            inAccount: true,
            detail: undefined,
            ...route,
          })
        ),
    };
  };

  test("a direct Billing link and Back to Account do not open an extra Profile route", async () => {
    const { navigate, show } = mountedOverview();
    await show({ detail: "billing", focused: false });
    await show();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("an overview opens Profile once it is linked and expanded", async () => {
    const { navigate, show } = mountedOverview();
    await show({ isExpanded: false });
    await show({ linked: false });
    expect(navigate).not.toHaveBeenCalled();
    await show();
    await show({ detail: "profile", focused: false });
    await show();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/account/profile", {
      dangerouslySingular: true,
    });
  });
});
