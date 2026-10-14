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
import { CustomerActivity } from "./overview-activity";

const makeCustomer = (id: string, displayName: string) => ({
  customer: { id, displayName, email: null, phone: null },
  customerId: id,
});

const overview = {
  ranges: {
    today: { from: "2026-08-11", to: "2026-08-11" },
    upcoming: { from: "2026-08-12", to: "2026-09-10" },
    lastSevenDays: { from: "2026-08-05", to: "2026-08-11" },
  },
  today: { completed: 1, unavailable: false, value: 2 },
  upcoming: { completed: 2, unavailable: false, value: 3 },
  lastSevenDays: { completed: 3, unavailable: false, value: 4 },
  uniqueCustomers: {
    customers: [
      makeCustomer("customer-alex", "Alex Morgan"),
      makeCustomer("customer-jordan", "Jordan Lee"),
      makeCustomer("customer-sam", "Sam Taylor"),
    ],
    unavailable: false,
    value: 4,
  },
  newCustomers: {
    customers: [
      makeCustomer("customer-riley", "Riley Chen"),
      makeCustomer("customer-casey", "Casey Smith"),
      makeCustomer("customer-drew", "Drew Jones"),
    ],
    unavailable: false,
    value: 3,
  },
};

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

describe("CustomerActivity", () => {
  test("shows unavailable customer metrics without a substitute count", async () => {
    const view = render(
      await CustomerActivity({
        overview: Promise.resolve({
          ...overview,
          uniqueCustomers: { customers: [], unavailable: true, value: 0 },
        }),
      })
    );

    expect(view.getByText("Unique customer count unavailable")).toBeDefined();
    expect(view.getByText("Live booking dates unavailable")).toBeDefined();
  });
});
