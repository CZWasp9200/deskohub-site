import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CustomerActivity, ReservationActivity } from "./overview-activity";

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

describe("ReservationActivity", () => {
  test("links each range to its inclusive start-date filter", async () => {
    const view = render(
      await ReservationActivity({ overview: Promise.resolve(overview) })
    );

    expect(view.getByRole("link", { name: /Today/ }).getAttribute("href")).toBe(
      "/admin/reservations?from=2026-08-11&to=2026-08-11"
    );
    expect(
      view.getByRole("link", { name: /Upcoming/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-12&to=2026-09-10");
    expect(
      view.getByRole("link", { name: /Last 7 days/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-05&to=2026-08-11");
  });

  test("announces completed reservations out of the total", async () => {
    const view = render(
      await ReservationActivity({ overview: Promise.resolve(overview) })
    );

    expect(
      view.getByText("1 completed out of 2 total reservations")
    ).toBeDefined();
  });

  test("keeps an unavailable range linked", async () => {
    const view = render(
      await ReservationActivity({
        overview: Promise.resolve({
          ...overview,
          upcoming: { completed: 0, unavailable: true, value: 0 },
        }),
      })
    );

    expect(
      view.getByRole("link", { name: /Upcoming/ }).getAttribute("href")
    ).toBe("/admin/reservations?from=2026-08-12&to=2026-09-10");
    expect(view.getByText("Live booking dates unavailable")).toBeDefined();
  });
});

describe("CustomerActivity", () => {
  test("lists three customers or two followed by the remaining count", async () => {
    const view = render(
      await CustomerActivity({ overview: Promise.resolve(overview) })
    );
    const uniqueCard = view.getByText("Unique customers").closest("div");
    const newCard = view.getByText("New customers").closest("div");

    expect(uniqueCard).not.toBeNull();
    expect(newCard).not.toBeNull();
    if (!(uniqueCard && newCard)) return;

    expect(within(uniqueCard).getByText("Alex Morgan")).toBeDefined();
    expect(within(uniqueCard).getByText("Jordan Lee")).toBeDefined();
    expect(within(uniqueCard).queryByText("Sam Taylor")).toBeNull();
    expect(within(uniqueCard).getByText("… and 2 more")).toBeDefined();
    expect(
      within(uniqueCard)
        .getByRole("link", { name: "Alex Morgan" })
        .getAttribute("href")
    ).toBe("/admin/customers/customer-alex");

    expect(within(newCard).getByText("Riley Chen")).toBeDefined();
    expect(within(newCard).getByText("Casey Smith")).toBeDefined();
    expect(within(newCard).getByText("Drew Jones")).toBeDefined();
    expect(within(newCard).queryByText(/more/)).toBeNull();
  });

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
