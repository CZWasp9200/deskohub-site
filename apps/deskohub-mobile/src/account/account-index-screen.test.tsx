import { describe, expect, mock, test } from "bun:test";
import { RegistryContext } from "@effect/atom-react";
import { AppLocaleProvider } from "../i18n/locale-context";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

mock.module("expo-router", () => expoRouterStandIn());

const { makeFakeCustomerData } = await import(
  "../customer-api/testing/customer-data-test-registry"
);
const { FocusedStatusBar } = await import("../ui/focused-status-bar");
const { Masthead } = await import("../ui/masthead");
const { ScrollScreen } = await import("../ui/scroll-screen");
const { elementTree, find } = await import("../ui/testing/element-tree");
const { AccountIndexScreen } = await import("./account-index-screen");

describe("Account overview status bar", () => {
  const overview = (activeSection?: "profile") => {
    const { registry } = makeFakeCustomerData("linked");
    const menu =
      activeSection === undefined
        ? undefined
        : { activeSection, openSection: () => undefined };
    return find(
      elementTree(AccountIndexScreen, { menu }, (children) => (
        <RegistryContext value={registry}>
          <AppLocaleProvider locale="en-US">{children}</AppLocaleProvider>
        </RegistryContext>
      )),
      ScrollScreen
    )?.props;
  };

  test("a standalone Account overview owns its masthead and collapsed status bars", () => {
    const props = overview();
    expect(find(props?.masthead, Masthead)).toBeDefined();
    expect(find(props?.collapsedHeader, FocusedStatusBar)).toBeDefined();
  });

  test("the expanded list leaves status bar ownership with its detail", () => {
    const props = overview("profile");
    expect(props?.masthead).toBeDefined();
    expect(find(props?.masthead, Masthead)).toBeUndefined();
    expect(find(props?.masthead, FocusedStatusBar)).toBeUndefined();
    expect(find(props?.collapsedHeader, FocusedStatusBar)).toBeUndefined();
  });
});
