import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AresLookupService } from "@deskohub/ares";
import { Effect, Layer, Result } from "effect";
import { FetchHttpClient } from "effect/http";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import { testCustomerSession } from "./account-operations.test-utils";
import { CompanyLookupService } from "./company-lookup.service";
import { CurrentCustomerAccount } from "./current-customer-account";

const syntheticCompany = {
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

type Registry = (ico: string) => Promise<Response>;

/** The public registry, answering each request the lookup makes. */
const registryAnswering = (answer: Registry) => {
  const requests: string[] = [];
  const fetch = Object.assign(
    (input: RequestInfo | URL) => {
      const ico = String(input).split("/").at(-1) ?? "";
      requests.push(ico);
      return answer(ico);
    },
    { preconnect: () => {} }
  );
  return { requests, fetch };
};

const lookUp = (
  ico: string,
  {
    registry,
    requireActive = Effect.succeed(testCustomerSession),
  }: {
    readonly registry: ReturnType<typeof registryAnswering>;
    readonly requireActive?: CurrentCustomerAccount["Service"]["requireActive"];
  }
) =>
  Effect.flatMap(CompanyLookupService, (companies) =>
    companies.lookup(ico)
  ).pipe(
    Effect.provide(
      CompanyLookupService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(CurrentCustomerAccount, { requireActive }),
            AresLookupService.Default.pipe(Layer.provide(FetchHttpClient.layer))
          )
        )
      )
    ),
    Effect.provideService(FetchHttpClient.Fetch, registry.fetch),
    Effect.result,
    Effect.runPromise
  );

const found = () => Promise.resolve(Response.json(syntheticCompany));

describe("CompanyLookupService", () => {
  test("fills the business billing fields from the registry's company with one request", async () => {
    const registry = registryAnswering(found);

    const outcome = await lookUp(" 27082440 ", { registry });

    expect(outcome).toEqual(
      Result.succeed({
        status: "found",
        company: {
          companyName: "Synthetická testovací s.r.o.",
          companyId: "27082440",
          vatId: "CZ27082440",
          addressLine1: "Testovací ulice 123/4",
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
      })
    );
    expect(registry.requests).toEqual(["27082440"]);
  });

  test.each([
    ["a wrong check digit", "27082441"],
    ["fewer than eight digits", "2708244"],
    ["a letter", "2708244a"],
  ])("never asks the registry for an ID with %s", async (_case, ico) => {
    const registry = registryAnswering(found);

    const outcome = await lookUp(ico, { registry });

    expect(outcome).toEqual(Result.succeed({ status: "invalid-ico" }));
    expect(registry.requests).toHaveLength(0);
  });

  test("reports a company the registry doesn't know as not found", async () => {
    const registry = registryAnswering(() =>
      Promise.resolve(
        Response.json(
          { kod: "NENALEZENO", popis: "Subjekt nenalezen" },
          { status: 404 }
        )
      )
    );

    const outcome = await lookUp("27082440", { registry });

    expect(outcome).toEqual(Result.succeed({ status: "not-found" }));
    expect(registry.requests).toHaveLength(1);
  });

  test.each([
    [
      "a server error",
      () => Promise.resolve(new Response(null, { status: 500 })),
    ],
    [
      "a network failure",
      () => Promise.reject(new TypeError("synthetic network failure")),
    ],
    [
      "another company's record",
      () =>
        Promise.resolve(
          Response.json({ ...syntheticCompany, ico: "00000019" })
        ),
    ],
  ])(
    "reports %s as an unavailable registry without retrying",
    async (_case, answer: Registry) => {
      const registry = registryAnswering(answer);

      const outcome = await lookUp("27082440", { registry });

      expect(outcome).toEqual(Result.succeed({ status: "unavailable" }));
      expect(registry.requests).toHaveLength(1);
    }
  );

  test.each([
    [
      "no session",
      new CustomerAccountAccessError({ reason: "unauthenticated" }),
    ],
    [
      "a pending deletion",
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      }),
    ],
  ])("never asks the registry with %s", async (_case, refusal) => {
    const registry = registryAnswering(found);

    const outcome = await lookUp("27082440", {
      registry,
      requireActive: Effect.fail(refusal),
    });

    expect(outcome).toEqual(Result.fail(refusal));
    expect(registry.requests).toHaveLength(0);
  });
});
