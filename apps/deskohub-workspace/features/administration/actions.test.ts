import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { DotyposService, DotyposUnavailable } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

mock.module("server-only", () => ({}));
await mockAdministrationActionRequest({
  administrator: "administration-actions",
  referer: "https://deskohub.test/en-US/admin",
});

const { AdministrationCustomerDirectory } = await import(
  "./customer-directory.service"
);
const { m } = await import("./i18n");

// The real directory over a Dotypos whose search fails.
const originalCustomerDirectory = AdministrationCustomerDirectory.Live;
AdministrationCustomerDirectory.Live =
  AdministrationCustomerDirectory.Default.pipe(
    Layer.provide(
      Layer.mock(DotyposService, {
        searchCustomers: () =>
          Effect.fail(
            new DotyposUnavailable({
              operation: "searchCustomers",
              reason: "server",
            })
          ),
      })
    )
  );

// Imported after the substitution, since the actions take the layer on load.
const { searchAdministrationCustomers } = await import("./actions");

afterAll(() => {
  AdministrationCustomerDirectory.Live = originalCustomerDirectory;
});

describe("searchAdministrationCustomers", () => {
  test("reports any failed search as unavailable", async () => {
    expect(await searchAdministrationCustomers({ query: "customer" })).toEqual({
      serverError: m.administrationCustomerSearchUnavailable(
        {},
        { locale: "en-US" }
      ),
    });
  });
});
