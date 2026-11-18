import { expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { m } from "@/features/administration/i18n";
import {
  getInvoiceCustomerErrorMessage,
  getInvoiceCustomerName,
  getInvoiceSourceLabel,
} from "./invoice-display";

test("labels the invoice provenance in the route locale", () => {
  expect(getInvoiceSourceLabel("dhw-cli", "cs-CZ")).toBe("CLI dhw");
  expect(getInvoiceSourceLabel("legacy", "en-US")).toBe("Legacy / unknown");
});

test("explains a rejected customer in the route locale", () => {
  expect(
    getInvoiceCustomerErrorMessage("customer-email-ambiguous", "cs-CZ")
  ).toBe(m.accountingInvoiceCustomerEmailAmbiguous({}, { locale: "cs-CZ" }));
  expect(
    getInvoiceCustomerErrorMessage("customer-email-ambiguous", "cs-CZ")
  ).not.toBe(
    getInvoiceCustomerErrorMessage("customer-email-ambiguous", "en-US")
  );
});

test("explains a deleted or expired customer as inactive", () => {
  for (const locale of supportedLocales)
    expect(getInvoiceCustomerErrorMessage("customer-deleted", locale)).toBe(
      m.accountingInvoiceCustomerInactive({}, { locale })
    );
});

test("names an unnamed customer in the route locale", () => {
  const unnamed = { displayName: "Unnamed customer", hasName: false };
  expect(getInvoiceCustomerName(unnamed, "cs-CZ")).toBe("Zákazník bez jména");
  expect(getInvoiceCustomerName(unnamed, "en-US")).toBe("Unnamed customer");
  expect(
    getInvoiceCustomerName(
      { displayName: "Ada Lovelace", hasName: true },
      "cs-CZ"
    )
  ).toBe("Ada Lovelace");
});
