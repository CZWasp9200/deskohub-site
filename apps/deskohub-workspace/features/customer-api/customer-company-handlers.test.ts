import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import {
  AresLookupFailure,
  AresLookupService,
  type EkonomickySubjekt,
} from "@deskohub/ares";
import { Effect, Layer } from "effect";
import { testCustomerSession } from "@/features/account/backend/account-operations.test-utils";
import { CompanyLookupService } from "@/features/account/backend/company-lookup.service";
import {
  type CustomerApiCall,
  type CustomerApiTestOptions,
  currentAccountResolving,
  customerApiRequest,
  linkedAccountServices,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";

const syntheticCompany: EkonomickySubjekt = {
  ico: "27082440",
  obchodniJmeno: "Synthetická testovací s.r.o.",
  dic: "CZ27082440",
  sidlo: {
    nazevUlice: "Testovací ulice",
    cisloDomovni: 123,
    cisloOrientacni: 4,
    nazevObce: "Praha",
    psc: 11000,
    kodStatu: "CZ",
  },
};

let registryAnswer: Effect.Effect<EkonomickySubjekt, AresLookupFailure>;
let registryRequests: string[];

beforeEach(() => {
  registryAnswer = Effect.succeed(syntheticCompany);
  registryRequests = [];
});

/**
 * The real company lookup over a registry that answers `registryAnswer`,
 * for the request's account standing.
 */
const companyRegistry = (
  services: CustomerApiTestOptions["services"] = linkedAccountServices
): CustomerApiTestOptions["services"] => ({
  ...services,
  companyLookup: CompanyLookupService.Default.pipe(
    Layer.provide(
      Layer.mock(AresLookupService, {
        lookup: (ico) =>
          Effect.suspend(() => {
            registryRequests.push(ico);
            return registryAnswer;
          }),
      })
    )
  ),
});

const lookupCompany = (companyId: string): CustomerApiCall => ({
  method: "GET",
  path: `/companies/${encodeURIComponent(companyId)}`,
});

describe("lookupCompany", () => {
  testCustomerEndpointGuards(lookupCompany("27082440"));

  test("answers the company's business billing details from one registry request", async () => {
    const api = makeCustomerApiTestServer({ services: companyRegistry() });

    const response = await api.handle(
      customerApiRequest(lookupCompany(" 27082440 "))
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      companyName: "Synthetická testovací s.r.o.",
      companyId: "27082440",
      vatId: "CZ27082440",
      addressLine1: "Testovací ulice 123/4",
      city: "Praha",
      zip: "11000",
      country: "CZ",
    });
    expect(registryRequests).toEqual(["27082440"]);
  });

  test("leaves out the VAT ID of a company without one", async () => {
    const { dic: _dic, ...withoutVatId } = syntheticCompany;
    registryAnswer = Effect.succeed(withoutVatId);
    const api = makeCustomerApiTestServer({ services: companyRegistry() });

    const response = await api.handle(
      customerApiRequest(lookupCompany("27082440"))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("vatId");
  });

  test("looks up for an account without a Dotypos profile, never resolving it", async () => {
    let resolutions = 0;
    const api = makeCustomerApiTestServer({
      services: companyRegistry({
        ...linkedAccountServices,
        currentAccount: currentAccountResolving((session) => {
          resolutions += 1;
          return { kind: "profile-missing", session, reviewMarker: "absent" };
        }),
      }),
    });

    const response = await api.handle(
      customerApiRequest(lookupCompany("27082440"))
    );

    expect(response.status).toBe(200);
    expect(resolutions).toBe(0);
  });

  test.each([
    ["InvalidIco", 400, "CustomerCompanyIdInvalid"],
    ["NotFound", 404, "CustomerCompanyNotFound"],
    ["Unavailable", 503, "CustomerCompanyRegistryUnavailable"],
  ] as const)("answers a registry %s as %d %s", async (reason, status, tag) => {
    registryAnswer = Effect.fail(new AresLookupFailure({ reason }));
    const api = makeCustomerApiTestServer({ services: companyRegistry() });

    const response = await api.handle(
      customerApiRequest(lookupCompany("27082440"))
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ _tag: tag });
  });

  test("answers an account awaiting deletion as deletion pending, asking no registry", async () => {
    const api = makeCustomerApiTestServer({
      session: { ...testCustomerSession, deletionRequested: true },
      services: companyRegistry(),
    });

    const response = await api.handle(
      customerApiRequest(lookupCompany("27082440"))
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
    expect(registryRequests).toEqual([]);
  });

  test("spends only the account's general budget, never a Dotypos budget", async () => {
    const api = makeCustomerApiTestServer({ services: companyRegistry() });

    await api.handle(customerApiRequest(lookupCompany("27082440")));

    expect(api.records.budgetSpends.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^customer-api:account:/),
    ]);
  });

  test("answers 429 once the account's general budget is spent, asking no registry", async () => {
    const api = makeCustomerApiTestServer({ services: companyRegistry() });
    const limit = 120;
    for (let request = 0; request < limit; request += 1) {
      await api.handle(customerApiRequest(lookupCompany("27082440")));
    }
    registryRequests = [];

    const response = await api.handle(
      customerApiRequest(lookupCompany("27082440"))
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ _tag: "CustomerRateLimited" });
    expect(registryRequests).toEqual([]);
  });
});
