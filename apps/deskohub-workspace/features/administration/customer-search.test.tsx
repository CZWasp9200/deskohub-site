import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactNode } from "react";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationCustomer } from "./customer-identity";
import { m } from "./i18n";

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads.
registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

const locale = "en-US";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({
    back: mock(),
    push: mock(),
    refresh: mock(),
    replace: mock(),
  }),
  unstable_rethrow: () => {},
}));

const searchAdministrationCustomers = mock();
mock.module("./actions", () => ({
  cancelAdministrationReservation: mock(),
  getAdministrationReservation: mock(),
  mutateReservationAccess: mock(),
  searchAdministrationCustomers,
}));

type ActionCallbacks = {
  readonly onSuccess: (result: { readonly data?: unknown }) => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

// Each test mounts one search, so the latest hook options are the ones its
// callbacks report to.
const actionCallbacks = new Map<
  typeof searchAdministrationCustomers,
  ActionCallbacks
>();
const execute = mock();
let isExecuting = false;

const report = (
  action: typeof searchAdministrationCustomers,
  run: (callbacks: ActionCallbacks) => void
) =>
  act(() => {
    const callbacks = actionCallbacks.get(action);
    if (!callbacks) throw new Error("The action hook was not mounted.");
    run(callbacks);
  });

const renderInLocale = async (node: ReactNode) => {
  const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
  return render(
    <RouteLocaleProvider locale={locale}>{node}</RouteLocaleProvider>
  );
};

const customer = (
  overrides: Partial<AdministrationCustomer>
): AdministrationCustomer => ({
  id: "dotypos-customer" as DotyposCustomerId,
  displayName: "Test Customer",
  hasName: true,
  email: testEmailAddress("customer-search"),
  phone: "+420 123 456 789",
  ...overrides,
});

describe("CustomerSearch", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    execute.mockReset();
    isExecuting = false;
    actionCallbacks.clear();
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation((action, options) => {
      actionCallbacks.set(
        action as typeof searchAdministrationCustomers,
        options as ActionCallbacks
      );
      return { execute, isExecuting, result: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });
  const search = async (query: string) => {
    const { CustomerSearch } = await import("./customer-search");
    const view = await renderInLocale(<CustomerSearch />);
    fireEvent.change(
      view.getByRole("searchbox", {
        name: m.administrationCustomerSearchLabel({}, { locale }),
      }),
      { target: { value: query } }
    );
    fireEvent.click(
      view.getByRole("button", {
        name: m.administrationCustomerSearchSubmit({}, { locale }),
      })
    );
    return view;
  };

  // Reports results only once the submit has cleared the previous ones.
  const submittedSearch = async (query: string) => {
    const view = await search(query);
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    return view;
  };

  test("searches by the trimmed query and lists ambiguous matches with their contacts", async () => {
    const view = await search("  Test  ");
    await waitFor(() => {
      expect(execute).toHaveBeenCalledWith({ query: "Test" });
    });

    const reachable = customer({});
    const unnamed = customer({
      id: "unnamed-customer" as DotyposCustomerId,
      displayName: "—",
      hasName: false,
      email: null,
      phone: null,
    });
    await report(searchAdministrationCustomers, ({ onSuccess }) =>
      onSuccess({
        data: { kind: "ambiguous", customers: [reachable, unnamed] },
      })
    );

    expect(
      view.getByText(m.administrationCustomerSearchAmbiguous({}, { locale }))
    ).toBeDefined();
    const items = view.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [reachableItem, unnamedItem] = items as [HTMLElement, HTMLElement];
    expect(
      within(reachableItem).getByText(reachable.displayName)
    ).toBeDefined();
    expect(
      within(reachableItem).getByText(`${reachable.email} · ${reachable.phone}`)
    ).toBeDefined();
    expect(
      within(unnamedItem).getByText(
        m.administrationCustomerUnnamed({}, { locale })
      )
    ).toBeDefined();
    expect(
      within(unnamedItem).getByText(
        m.administrationCustomerNoContactDetails({}, { locale })
      )
    ).toBeDefined();
    expect(
      within(unnamedItem)
        .getByRole("link", {
          name: m.administrationCustomerSearchOpenCustomer({}, { locale }),
        })
        .getAttribute("href")
    ).toBe(`/${locale}/admin/customers/unnamed-customer`);
  });

  test("shows a single match without the ambiguity note and an empty result as empty", async () => {
    const view = await submittedSearch("Test");
    await report(searchAdministrationCustomers, ({ onSuccess }) =>
      onSuccess({ data: { kind: "matched", customers: [customer({})] } })
    );
    expect(view.getAllByRole("listitem")).toHaveLength(1);
    expect(
      view.queryByText(m.administrationCustomerSearchAmbiguous({}, { locale }))
    ).toBeNull();

    await report(searchAdministrationCustomers, ({ onSuccess }) =>
      onSuccess({ data: { kind: "not-found", customers: [] } })
    );
    expect(view.queryAllByRole("listitem")).toEqual([]);
    expect(
      view.getByText(m.administrationCustomerSearchEmpty({}, { locale }))
    ).toBeDefined();
  });

  test("ignores a success without data", async () => {
    const view = await submittedSearch("Test");
    await report(searchAdministrationCustomers, ({ onSuccess }) =>
      onSuccess({})
    );
    expect(view.queryByRole("list")).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("shows the server's error, a fallback, or the transport failure and clears results", async () => {
    const view = await submittedSearch("Test");
    await report(searchAdministrationCustomers, ({ onSuccess }) =>
      onSuccess({ data: { kind: "matched", customers: [customer({})] } })
    );

    await report(searchAdministrationCustomers, ({ onError }) =>
      onError({ error: { serverError: "Dotypos is unavailable." } })
    );
    expect(view.getByRole("alert").textContent).toBe("Dotypos is unavailable.");
    expect(view.queryByRole("list")).toBeNull();

    await report(searchAdministrationCustomers, ({ onError }) =>
      onError({ error: {} })
    );
    expect(view.getByRole("alert").textContent).toBe(
      m.administrationCustomerSearchFailed({}, { locale })
    );

    await report(searchAdministrationCustomers, ({ onSuccess }) =>
      onSuccess({ data: { kind: "matched", customers: [customer({})] } })
    );
    expect(view.queryByRole("alert")).toBeNull();

    await report(searchAdministrationCustomers, ({ onTransportError }) =>
      onTransportError()
    );
    expect(view.getByRole("alert").textContent).toBe(
      m.administrationCustomerSearchFailed({}, { locale })
    );
    expect(view.queryByRole("list")).toBeNull();
  });

  test("rejects a query shorter than two characters without searching", async () => {
    const view = await search(" a ");
    await waitFor(() => {
      expect(
        view.getByText(
          m.administrationCustomerSearchQueryLength({}, { locale })
        )
      ).toBeDefined();
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("disables the search while it runs", async () => {
    isExecuting = true;
    const { CustomerSearch } = await import("./customer-search");
    const view = await renderInLocale(<CustomerSearch variant="toolbar" />);
    const button = view.getByRole("button", {
      name: m.administrationCustomerSearching({}, { locale }),
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
