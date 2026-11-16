import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { DotyposCustomer } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import type { AdministrationCustomerActivity } from "@/features/administration/administration.service";
import { loadFixtureReservations } from "@/features/administration/fixtures";
import type { AdministrationCustomerLookup } from "@/features/administration/page-data.server";
import type { AdminCustomerDiscountSections } from "@/features/discounts/admin/discount-administration.service";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
// The page's client components read the router outside a Next app router.
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({ back: mock(), refresh: mock(), replace: mock() }),
}));

const customerId = "customer-alex";

const customer = {
  id: customerId,
  firstName: "Alex",
  lastName: "Example",
  email: testEmailAddress("alex"),
  deleted: false,
} as DotyposCustomer;
const customerName = "Alex Example";
const found: AdministrationCustomerLookup = { kind: "found", customer };

const sections: AdminCustomerDiscountSections = {
  discountGroups: [],
  codes: [],
  claims: [],
  vouchers: [],
  voucherClaims: [],
};

const reservations = loadFixtureReservations({ customerId }).items.map(
  (reservation) => ({ ...reservation, customer: null })
);

const fullHistory: AdministrationCustomerActivity = {
  reservations,
  reservationHistoryTruncated: false,
  transactions: [],
  transactionHistoryTruncated: false,
  stats: {
    reservationCount: reservations.length,
    favoriteProduct: null,
    favoriteReservationProduct: null,
    revenue: [],
    discountSavings: [],
  },
  marketingConsent: null,
};

let lookup: AdministrationCustomerLookup = found;
let liveSections: AdminCustomerDiscountSections | null = sections;
let activity: AdministrationCustomerActivity = fullHistory;

const discountPageData = await import(
  "@/features/discounts/admin/page-data.server"
);
mock.module("@/features/discounts/admin/page-data.server", () => ({
  ...discountPageData,
  loadDiscountCustomerSections: () =>
    Promise.resolve({ notice: undefined, sections: liveSections }),
}));
const administrationPageData = await import(
  "@/features/administration/page-data.server"
);
mock.module("@/features/administration/page-data.server", () => ({
  ...administrationPageData,
  loadAdministrationCustomer: () => Promise.resolve(lookup),
  loadAdministrationCustomerActivity: () => Promise.resolve(activity),
  loadAdministrationCustomerReservationActivity: () =>
    Promise.resolve({ from: "2025-08-25", to: "2026-08-24", dates: [] }),
}));

// The page's server modules read server-only settings, so it loads before
// the DOM environment exists.
const { AdministrationCustomerDetailContent } = await import("./page");

async function prerenderCustomerDetail() {
  const { prelude } = await prerender(
    <RouteLocaleProvider locale="en-US">
      <AdministrationCustomerDetailContent
        params={Promise.resolve({ customerId })}
        searchParams={Promise.resolve({})}
      />
    </RouteLocaleProvider>,
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return container;
}

const reservationLinks = (container: HTMLElement) =>
  [...container.querySelectorAll("a")].filter((link) =>
    /\/admin\/reservations\/[^/?]+$/.test(link.getAttribute("href") ?? "")
  );

const allReservationsLink = (container: HTMLElement) =>
  [...container.querySelectorAll("a")].find((link) =>
    link
      .getAttribute("href")
      ?.endsWith(`/admin/reservations?customerId=${customerId}`)
  );

describe("AdministrationCustomerDetailContent", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    lookup = found;
    liveSections = sections;
    activity = fullHistory;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("shows the customer's administration page when Dotypos returns the customer and the discount sections load", async () => {
    const container = await prerenderCustomerDetail();

    expect(
      within(container).getByRole("heading", { level: 1 }).textContent
    ).toContain(customerName);
    expect(
      container.querySelector(
        `a[href$="/admin/customers/${customerId}/create-code"]`
      )
    ).not.toBeNull();
  });

  test.each([
    {
      case: "the customer lookup is unavailable",
      lookup: { kind: "unavailable" },
      sections,
    },
    {
      case: "Dotypos has no such customer",
      lookup: { kind: "absent" },
      sections,
    },
    { case: "the discount sections fail", lookup: found, sections: null },
  ] satisfies readonly {
    readonly case: string;
    readonly lookup: AdministrationCustomerLookup;
    readonly sections: AdminCustomerDiscountSections | null;
  }[])("shows only the Workspace history when $case", async (state) => {
    lookup = state.lookup;
    liveSections = state.sections;
    const container = await prerenderCustomerDetail();

    expect(
      within(container).getByRole("heading", { level: 1 }).textContent
    ).not.toContain(customerName);
    expect(
      container.querySelector(
        `a[href$="/admin/customers/${customerId}/create-code"]`
      )
    ).toBeNull();
  });

  test("lists the Workspace reservation history when the profile is unavailable", async () => {
    lookup = { kind: "unavailable" };
    const container = await prerenderCustomerDetail();

    expect(
      within(container).getByRole("heading", { level: 1 }).textContent
    ).not.toContain(customerName);
    expect(reservations).not.toHaveLength(0);
    expect(reservationLinks(container).length).toBeGreaterThanOrEqual(
      reservations.length
    );
    expect(allReservationsLink(container)).toBeUndefined();
  });

  test("links the full reservation list when the unavailable profile's history is truncated", async () => {
    lookup = { kind: "unavailable" };
    activity = { ...fullHistory, reservationHistoryTruncated: true };
    const container = await prerenderCustomerDetail();

    expect(allReservationsLink(container)).toBeDefined();
  });
});
