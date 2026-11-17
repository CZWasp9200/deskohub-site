import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationCustomerActivity } from "./administration.service";
import type { AdministrationCustomer } from "./customer-identity";
import { loadFixtureReservations } from "./fixtures";
import { m } from "./i18n";

const locale = "en-US";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({ push: mock(), refresh: mock(), replace: mock() }),
}));

const { AdministrationCustomerDetail } = await import("./customer-detail");

const customer = {
  id: "dotypos-customer",
  displayName: "Synthetic Customer",
  hasName: true,
  email: null,
  phone: null,
} as AdministrationCustomer;

const reservations = loadFixtureReservations({
  customerId: "customer-alex",
}).items.map((reservation) => ({ ...reservation, customer: null }));

/** Discount slots as plain nodes, so a test can find where the layout puts each. */
const discounts = {
  availableCodes: { label: "slot-available-label", value: "slot-available" },
  promotions: <section data-slot="promotions" />,
  currentGroup: { label: "slot-group-label", value: "slot-group" },
  groupForm: <section data-slot="group-form" />,
};

const renderCustomerDetail = (
  overrides: {
    readonly reservations?: typeof reservations;
    readonly reservationHistoryTruncated?: boolean;
    readonly transactionHistoryTruncated?: boolean;
  } = {}
) => {
  const activity: AdministrationCustomerActivity = {
    reservations: overrides.reservations ?? [],
    reservationHistoryTruncated: overrides.reservationHistoryTruncated ?? false,
    transactions: [],
    transactionHistoryTruncated: overrides.transactionHistoryTruncated ?? false,
    stats: {
      reservationCount: 0,
      favoriteProduct: null,
      favoriteReservationProduct: null,
      revenue: [],
      discountSavings: [],
    },
    marketingConsent: null,
  };
  return render(
    <AdministrationCustomerDetail
      activity={activity}
      customerId={customer.id}
      locale={locale}
      notice={{ message: "Saved.", status: "success" }}
      profile={{ customer, discounts }}
      reservationActivity={{ from: "2025-08-25", to: "2026-08-24", dates: [] }}
    />
  );
};

describe("AdministrationCustomerDetail", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("shows a customer without contacts or history", () => {
    const view = renderCustomerDetail();

    expect(view.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(
      view.queryByText(
        m.administrationCustomerProfileTransactionsTruncated({}, { locale })
      )
    ).toBeNull();
    expect(
      view.queryByRole("link", {
        name: m.administrationCustomerProfileViewAllReservations(
          {},
          { locale }
        ),
      })
    ).toBeNull();
    expect(
      view.getByText(
        m.administrationCustomerProfileCurrentReservationsEmpty({}, { locale })
      )
    ).toBeDefined();
  });

  test("links truncated reservations and lists undated ones", () => {
    const [dated] = reservations;
    if (!dated) throw new Error("The fixture has no reservations.");
    const view = renderCustomerDetail({
      reservations: [dated, { ...dated, id: "undated", endsAt: null }],
      reservationHistoryTruncated: true,
      transactionHistoryTruncated: true,
    });

    expect(
      view
        .getByRole("link", {
          name: m.administrationCustomerProfileViewAllReservations(
            {},
            { locale }
          ),
        })
        .getAttribute("href")
    ).toBe(
      `/${locale}/admin/reservations?customerId=${encodeURIComponent(customer.id)}`
    );
    expect(
      view.getByText(
        m.administrationCustomerProfileUnavailableDateReservations(
          { count: "1" },
          { locale }
        )
      )
    ).toBeDefined();
    expect(
      view.getByText(
        m.administrationCustomerProfileTransactionsTruncated({}, { locale })
      )
    ).toBeDefined();
  });

  test("places each discount slot in its section", () => {
    const view = renderCustomerDetail();

    // Each fact closes its list: the stats, then the contact card.
    const stat = view.getByText("slot-available-label", { selector: "dt" });
    expect(stat.nextElementSibling?.textContent).toBe("slot-available");
    expect(stat.closest("dl")?.lastElementChild?.contains(stat)).toBe(true);
    const group = view.getByText("slot-group-label", { selector: "dt" });
    expect(group.nextElementSibling?.textContent).toBe("slot-group");
    expect(group.closest("dl")?.lastElementChild?.contains(group)).toBe(true);
    expect(group.closest("aside")).not.toBeNull();

    const promotions = view.container.querySelector('[data-slot="promotions"]');
    const groupForm = view.container.querySelector('[data-slot="group-form"]');
    const transactions = view.getByRole("heading", {
      name: m.administrationCustomerProfileTransactionsTitle({}, { locale }),
    });
    const reference = view.getByText(
      m.administrationCustomerProfileReferenceTitle({}, { locale })
    );
    if (!promotions || !groupForm) throw new Error("A slot is missing.");
    // Codes and claims follow the transactions; the group form precedes the reference.
    expect(
      transactions.compareDocumentPosition(promotions) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      groupForm.compareDocumentPosition(reference) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(groupForm.closest("aside")).not.toBeNull();
  });
});
