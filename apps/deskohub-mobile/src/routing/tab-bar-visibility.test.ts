import { describe, expect, test } from "bun:test";
import { tabBarHidden } from "./tab-bar-visibility";

describe("tabBarHidden", () => {
  test("the profile and billing forms hide the tab bar", () => {
    expect(tabBarHidden("account", "profile")).toBe(true);
    expect(tabBarHidden("account", "billing")).toBe(true);
  });

  test("the Account root and other sections keep it", () => {
    expect(tabBarHidden("account", undefined)).toBe(false);
    expect(tabBarHidden("account", "index")).toBe(false);
    expect(tabBarHidden("account", "language")).toBe(false);
    expect(tabBarHidden("account", "invoices")).toBe(false);
  });

  test("a screen of the same name in another tab keeps it", () => {
    expect(tabBarHidden("reservations", "profile")).toBe(false);
  });
});
