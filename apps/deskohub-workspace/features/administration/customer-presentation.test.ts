import { describe, expect, test } from "bun:test";
import type { AdministrationCustomerName } from "./customer-name";
import { getAdministrationCustomerName } from "./customer-presentation";
import { m } from "./i18n";

const customer = (
  fields: Partial<AdministrationCustomerName>
): AdministrationCustomerName => ({
  displayName: "Synthetic Person",
  hasName: true,
  lifecycle: "active",
  ...fields,
});

describe("getAdministrationCustomerName", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "shows an active customer's own name in %s",
    (locale) => {
      expect(getAdministrationCustomerName(customer({}), locale)).toBe(
        "Synthetic Person"
      );
    }
  );

  test.each([
    [{ hasName: false }, m.administrationCustomerUnnamed],
    [{ lifecycle: "deleted" }, m.administrationCustomerDeleted],
    [{ lifecycle: "expired" }, m.administrationCustomerExpired],
    [{ hasName: false, lifecycle: "deleted" }, m.administrationCustomerDeleted],
  ] as const)("names %o in the route language", (fields, message) => {
    for (const locale of ["en-US", "cs-CZ"] as const)
      expect(getAdministrationCustomerName(customer(fields), locale)).toBe(
        message({}, { locale })
      );
  });

  test("never shows a deleted or expired customer's stored name", () => {
    for (const lifecycle of ["deleted", "expired"] as const)
      expect(
        getAdministrationCustomerName(customer({ lifecycle }), "en-US")
      ).not.toBe("Synthetic Person");
  });
});
