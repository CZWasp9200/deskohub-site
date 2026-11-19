import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import { HttpApi } from "effect/http-api";
import { customerRequestBudgetClasses } from "./customer-request-budget";

/** Each contract endpoint's method, by `group.endpoint`. */
const contractMethods = () => {
  const methods = new Map<string, string>();
  HttpApi.reflect(WorkspaceCustomerApi, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint }) => {
      methods.set(
        `${group.identifier}.${endpoint.identifier}`,
        endpoint.method
      );
    },
  });
  return methods;
};

const contractEndpoints = () => [...contractMethods().keys()].toSorted();

describe("customer request budget classes", () => {
  test("classify exactly the endpoints the contract has", () => {
    const classified = Object.entries(customerRequestBudgetClasses)
      .flatMap(([group, endpoints]) =>
        Object.keys(endpoints).map((endpoint) => `${group}.${endpoint}`)
      )
      .toSorted();

    expect(contractEndpoints().length).toBeGreaterThan(0);
    expect(classified).toEqual(contractEndpoints());
  });

  test("classify the endpoints that never reach Dotypos as workspace-only", () => {
    expect(customerRequestBudgetClasses.account).toMatchObject({
      updateLocale: "workspace-only",
      listPasskeys: "workspace-only",
      listAssistantConnections: "workspace-only",
      syncAnalyticsConsent: "workspace-only",
      getAnalyticsPreference: "workspace-only",
      saveAnalyticsPreference: "workspace-only",
    });
    expect(customerRequestBudgetClasses.reservations).toMatchObject({
      getEstablishment: "workspace-only",
    });
    expect(customerRequestBudgetClasses.booking).toMatchObject({
      listLegalDocuments: "workspace-only",
      acceptCheckoutPriceChange: "workspace-only",
    });
    expect(customerRequestBudgetClasses.companies).toMatchObject({
      lookupCompany: "workspace-only",
    });
  });

  test("give each Dotypos-backed endpoint the budget of its method: GET reads, every other method mutates", () => {
    const methods = contractMethods();
    const mismatched = Object.entries(customerRequestBudgetClasses).flatMap(
      ([group, endpoints]) =>
        Object.entries(endpoints)
          .filter(([, budgetClass]) => budgetClass !== "workspace-only")
          .filter(
            ([endpoint, budgetClass]) =>
              (methods.get(`${group}.${endpoint}`) === "GET") !==
              (budgetClass === "account-read" ||
                budgetClass === "dotypos-read" ||
                budgetClass === "catalog-read")
          )
          .map(
            ([endpoint, budgetClass]) => `${group}.${endpoint}: ${budgetClass}`
          )
    );

    expect(mismatched).toEqual([]);
    expect(
      Object.values(customerRequestBudgetClasses.account).filter(
        (budgetClass) => budgetClass === "dotypos-read"
      )
    ).toHaveLength(3);
    expect(
      Object.values(customerRequestBudgetClasses.reservations).filter(
        (budgetClass) => budgetClass === "dotypos-read"
      )
    ).toHaveLength(1);
    expect(
      Object.values(customerRequestBudgetClasses.booking).filter(
        (budgetClass) => budgetClass === "dotypos-read"
      )
    ).toHaveLength(0);
    expect(
      Object.values(customerRequestBudgetClasses.invoices).filter(
        (budgetClass) => budgetClass === "dotypos-read"
      )
    ).toHaveLength(3);
    expect(
      Object.values(customerRequestBudgetClasses.booking).filter(
        (budgetClass) => budgetClass === "dotypos-mutation"
      )
    ).toHaveLength(4);
  });

  test("give removing a discount code the budget of entering one", () => {
    expect(customerRequestBudgetClasses.booking.clearCheckoutDiscountCode).toBe(
      customerRequestBudgetClasses.booking.applyCheckoutDiscountCode
    );
  });
  // The app reads the account on every load, the history on every visit and
  // a settling order's status while it polls, so these reads spend their own
  // budget instead of the Dotypos reads the other sections share.
  test("classify the reads the app repeats while navigating and polling as account reads", () => {
    const accountReads = Object.entries(customerRequestBudgetClasses)
      .flatMap(([group, endpoints]) =>
        Object.entries(endpoints)
          .filter(([, budgetClass]) => budgetClass === "account-read")
          .map(([endpoint]) => `${group}.${endpoint}`)
      )
      .toSorted();

    expect(accountReads).toEqual([
      "account.getAccount",
      "reservations.getReservationAccess",
      "reservations.getReservationStatus",
      "reservations.listInvitedReservations",
      "reservations.listReservations",
    ]);
    expect(customerRequestBudgetClasses).toMatchObject({
      account: {
        getMarketingPreferences: "dotypos-read",
        getReferrals: "dotypos-read",
      },
      reservations: { getReservationInvoice: "dotypos-read" },
      invoices: {
        listInvoices: "dotypos-read",
        getInvoicePdf: "dotypos-read",
        getCorrectiveDocumentPdf: "dotypos-read",
      },
    });
  });

  // Browsing the catalog reads the shared snapshots many times per booking,
  // so it spends its own budget instead of the account's Dotypos reads.
  test("classify the booking catalog's reads as catalog reads", () => {
    expect(customerRequestBudgetClasses.booking).toMatchObject({
      listOfferings: "catalog-read",
      getAvailability: "catalog-read",
      getMeetingRoomStartTimes: "catalog-read",
      getMeetingRoomUnavailableDates: "catalog-read",
      getQuote: "catalog-read",
    });
  });
});
