import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CustomerTransactionHistoryTable } from "./customer-transaction-table";
import { loadFixtureReservations } from "./fixtures";

describe("CustomerTransactionHistoryTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("renders customer payments in the operator's locale", () => {
    const paidReservation = loadFixtureReservations({
      customerId: "customer-alex",
    }).items.find(({ latestPayment }) => latestPayment?.state === "paid");
    const attempt = paidReservation?.latestPayment;
    if (!paidReservation || !attempt) {
      throw new Error("The fixtures have no paid reservation");
    }
    const reservation = {
      ...paidReservation,
      product: { kind: "cowork", tier: "reserved-desk" },
    } as const;
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CustomerTransactionHistoryTable
          transactions={[
            { attempt, reservation, updatedAtLabel: "1. 8. 2026 10:00" },
            {
              attempt: {
                ...attempt,
                id: `${attempt.id}-refunded`,
                refundState: "refunded",
                refundedAmount: {
                  ...attempt.amount,
                  value: attempt.amount.value / 2,
                },
                refundedAt: "2026-08-03T08:00:00Z",
              },
              reservation,
              updatedAtLabel: "3. 8. 2026 10:00",
            },
          ]}
        />
      </RouteLocaleProvider>
    );
    const transactions = within(
      view.getByRole("table", { name: "Historie transakcí zákazníka" })
    );
    const [paidRow, refundedRow] = transactions.getAllByRole("row").slice(1);

    expect(within(paidRow!).getByText("Zaplaceno")).toBeDefined();
    expect(within(refundedRow!).getByText(/^Částečně vráceno /)).toBeDefined();
    expect(refundedRow?.textContent).toContain("před vrácením peněz");
    expect(refundedRow?.textContent).toContain("po vrácení peněz");
    expect(transactions.getAllByText("Vyhrazené místo")).toHaveLength(2);
  });
});
