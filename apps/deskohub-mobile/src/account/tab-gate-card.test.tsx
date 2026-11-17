import { describe, expect, mock, test } from "bun:test";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

mock.module("expo-router", () => expoRouterStandIn());

const { TabGateCard } = await import("./tab-gate-card");
const { AppLocaleProvider } = await import("../i18n/locale-context");
const { elementTree, findAll, hostTree } = await import(
  "../ui/testing/element-tree"
);

const actions = (props: Parameters<typeof TabGateCard>[0]) =>
  findAll(
    hostTree(
      elementTree(TabGateCard, props, (node) => (
        <AppLocaleProvider locale="en-US">{node}</AppLocaleProvider>
      ))
    ),
    "Pressable"
  );

describe("TabGateCard", () => {
  test("the support card has one action, Contact us", () => {
    expect(actions({ gate: "support" })).toHaveLength(1);
  });

  test("the account that didn't load offers Try again, which retries", () => {
    const onRetry = mock(() => undefined);
    const [retry, ...rest] = actions({ gate: "unavailable", onRetry });
    expect(rest).toHaveLength(0);
    if (retry === undefined) throw new Error("no Try again");
    (retry.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("without a way to retry, the unavailable card has no action", () => {
    expect(actions({ gate: "unavailable" })).toHaveLength(0);
  });
});
