import { describe, expect, mock, test } from "bun:test";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

mock.module("expo-router", () => expoRouterStandIn());

const { backToStartTab } = await import("./back-to-start-tab");

const tabs = (open: string, stackIndex?: number) => ({
  key: "tabs",
  index: ["account", "book", "reservations"].indexOf(open),
  routes: ["account", "book", "reservations"].map((name) => ({
    name,
    ...(name === open && stackIndex !== undefined
      ? { state: { index: stackIndex } }
      : {}),
  })),
});

describe("backToStartTab", () => {
  test("from another tab's root, back goes to the start tab", () => {
    expect(backToStartTab(tabs("account"), "book")).toBe("book");
    expect(backToStartTab(tabs("account", 0), "reservations")).toBe(
      "reservations"
    );
    expect(backToStartTab(tabs("book", 0), "reservations")).toBe(
      "reservations"
    );
    expect(backToStartTab(tabs("reservations"), "book")).toBe("book");
  });

  test("from the start tab's root, back leaves it to the app (out)", () => {
    expect(backToStartTab(tabs("book", 0), "book")).toBeUndefined();
    expect(
      backToStartTab(tabs("reservations", 0), "reservations")
    ).toBeUndefined();
  });

  test("on a tab's sub-screen, its stack goes back first", () => {
    expect(backToStartTab(tabs("account", 1), "book")).toBeUndefined();
    expect(backToStartTab(tabs("reservations", 2), "book")).toBeUndefined();
  });
});
