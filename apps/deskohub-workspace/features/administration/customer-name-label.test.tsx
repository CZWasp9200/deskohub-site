import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationCustomerName } from "./customer-name";
import {
  AdministrationCustomerNameLabel,
  AdministrationCustomerNameLink,
} from "./customer-name-label";
import { m } from "./i18n";

const customerId = "customer-1" as DotyposCustomerId;

const customer = (
  fields: Partial<AdministrationCustomerName>
): AdministrationCustomerName => ({
  displayName: "Synthetic Person",
  hasName: true,
  lifecycle: "active",
  ...fields,
});

const renderLink = (name: AdministrationCustomerName) =>
  render(
    <RouteLocaleProvider locale="en-US">
      <AdministrationCustomerNameLink
        customer={name}
        customerId={customerId}
        locale="en-US"
      />
    </RouteLocaleProvider>
  );

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

describe("AdministrationCustomerNameLabel", () => {
  test.each([
    ["deleted", m.administrationCustomerDeleted],
    ["expired", m.administrationCustomerExpired],
  ] as const)("marks a %s customer's placeholder", (lifecycle, message) => {
    const view = render(
      <AdministrationCustomerNameLabel
        customer={customer({ lifecycle, hasName: false })}
        locale="en-US"
      />
    );

    const marked = view.container.querySelector(
      `[data-customer-lifecycle="${lifecycle}"]`
    );
    expect(marked?.textContent).toBe(message({}, { locale: "en-US" }));
    expect(marked?.querySelector("svg[aria-hidden]")).not.toBeNull();
  });

  test.each([
    ["a named customer", customer({}), "Synthetic Person"],
    [
      "an unnamed customer",
      customer({ hasName: false }),
      m.administrationCustomerUnnamed({}, { locale: "en-US" }),
    ],
  ])("renders %s as plain text", (_, name, expected) => {
    const view = render(
      <AdministrationCustomerNameLabel customer={name} locale="en-US" />
    );

    expect(view.container.textContent).toBe(expected);
    expect(
      view.container.querySelector("[data-customer-lifecycle]")
    ).toBeNull();
    expect(view.container.querySelector("svg")).toBeNull();
  });
});

describe("AdministrationCustomerNameLink", () => {
  test("links an active customer to their detail page", () => {
    const view = renderLink(customer({}));

    expect(
      view.getByRole("link", { name: "Synthetic Person" }).getAttribute("href")
    ).toContain(`/admin/customers/${customerId}`);
  });

  test.each(["deleted", "expired"] as const)(
    "doesn't link a %s customer, who has no detail page",
    (lifecycle) => {
      const view = renderLink(customer({ lifecycle, hasName: false }));

      expect(view.queryByRole("link")).toBeNull();
      expect(
        view.container.querySelector(`[data-customer-lifecycle="${lifecycle}"]`)
      ).not.toBeNull();
    }
  );
});
