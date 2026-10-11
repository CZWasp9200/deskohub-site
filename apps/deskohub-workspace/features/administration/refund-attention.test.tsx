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
import { RefundAttention } from "./refund-attention";

describe("RefundAttention", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("links reservations needing a refund to the refund queue", async () => {
    const view = render(await RefundAttention({ count: Promise.resolve(2) }));

    expect(view.getByText("2 reservations need a refund.")).toBeDefined();
    expect(
      view.getByRole("link", { name: "Review refunds" }).getAttribute("href")
    ).toBe("/admin/reservations?status=needs_refund");
  });

  test("uses the singular for one reservation needing a refund", async () => {
    const view = render(await RefundAttention({ count: Promise.resolve(1) }));

    expect(view.getByText("1 reservation needs a refund.")).toBeDefined();
  });

  test("renders nothing when no reservation needs a refund", async () => {
    expect(await RefundAttention({ count: Promise.resolve(0) })).toBeNull();
  });
});
