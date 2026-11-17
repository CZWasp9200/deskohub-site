import { describe, expect, test } from "bun:test";
import { Context, Option } from "effect";
import { HttpApi, type HttpApiGroup, OpenApi } from "effect/http-api";
import { customerInputParseOptions } from "./customer-profile";
import {
  CustomerRequestOriginCheck,
  CustomerSessionAuthentication,
} from "./customer-session";
import {
  customerApiPathPrefix,
  WorkspaceCustomerApi,
} from "./workspace-customer-api";

/**
 * Released mobile builds decode every customer endpoint as it was when each
 * build shipped, so the OpenAPI document recorded here may only change on
 * purpose. Regenerate it with
 * `UPDATE_OPENAPI=1 bun test src/workspace-customer-api.test.ts` and review
 * the diff. The test writes the fixture in Biome's format.
 *
 * A shipped build fails to decode a response variant, status or reason it
 * doesn't know, so adding one is a breaking change: keep what shipped builds
 * decode, or serve the change under a new API version.
 */
const fixture = new URL(
  "./workspace-customer-api.openapi.golden.json",
  import.meta.url
);

const endpointsOf = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>
) => {
  const endpoints: Array<{
    readonly reference: string;
    readonly group: string;
    readonly path: string;
    readonly middleware: ReadonlyArray<string>;
    readonly payloadParseOptions: Option.Option<unknown>;
  }> = [];
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware, mergedAnnotations }) => {
      endpoints.push({
        reference: `${group.identifier}.${endpoint.identifier}`,
        group: group.identifier,
        path: endpoint.path,
        middleware: [...middleware].map((service) => service.key),
        payloadParseOptions: Context.getOption(
          mergedAnnotations,
          HttpApi.PayloadParseOptions
        ),
      });
    },
  });
  return endpoints;
};

describe("WorkspaceCustomerApi", () => {
  const endpoints = endpointsOf(WorkspaceCustomerApi);

  test("declares the account, reservations, booking, invoices and companies groups", () => {
    expect(Object.keys(WorkspaceCustomerApi.groups).sort()).toEqual([
      "account",
      "booking",
      "companies",
      "invoices",
      "reservations",
    ]);
  });

  test("serves every endpoint under its group's customer API prefix", () => {
    expect(endpoints.length).toBeGreaterThan(0);
    for (const endpoint of endpoints) {
      expect({
        reference: endpoint.reference,
        underGroupPrefix:
          endpoint.path === `${customerApiPathPrefix}/${endpoint.group}` ||
          endpoint.path.startsWith(
            `${customerApiPathPrefix}/${endpoint.group}/`
          ),
      }).toEqual({ reference: endpoint.reference, underGroupPrefix: true });
    }
  });

  // The account and checkout mutations refuse fields they don't know and
  // report every issue, on the server and in the typed client.
  test("decodes exactly the customer input payloads strictly", () => {
    const strict = endpoints.filter(({ payloadParseOptions }) =>
      Option.isSome(payloadParseOptions)
    );

    expect(
      strict.map(({ reference, payloadParseOptions }) => ({
        reference,
        options: Option.getOrUndefined(payloadParseOptions),
      }))
    ).toEqual(
      [
        "account.updateProfile",
        "account.updateLocale",
        "account.completeProfile",
        "account.saveMarketingPreferences",
        "account.syncAnalyticsConsent",
        "account.saveAnalyticsPreference",
        "account.requestDeletion",
        "reservations.reopenPaymentPage",
        "reservations.retryPayment",
        "booking.createCheckout",
        "booking.applyCheckoutDiscountCode",
        "booking.clearCheckoutDiscountCode",
        "booking.acceptCheckoutPriceChange",
        "booking.submitCheckout",
      ].map((reference) => ({ reference, options: customerInputParseOptions }))
    );
  });

  // HttpApiBuilder wraps the handler in each middleware in insertion order,
  // so the last one added runs first: the origin check refuses a cross-site
  // request before the session lookup spends anything.
  test("runs the origin check before session authentication on every endpoint", () => {
    for (const endpoint of endpoints) {
      expect({
        reference: endpoint.reference,
        middleware: endpoint.middleware,
      }).toEqual({
        reference: endpoint.reference,
        middleware: [
          CustomerSessionAuthentication.key,
          CustomerRequestOriginCheck.key,
        ],
      });
    }
  });

  test("keeps its recorded OpenAPI document", async () => {
    const current = OpenApi.fromApi(WorkspaceCustomerApi);
    if (process.env.UPDATE_OPENAPI === "1") {
      await Bun.write(fixture, `${JSON.stringify(current, null, 2)}\n`);
      // Biome lints the fixture, so write it in Biome's committed form.
      const formatted = Bun.spawnSync(
        ["bun", "x", "biome", "format", "--write", fixture.pathname],
        { cwd: new URL("../../..", import.meta.url).pathname }
      );
      expect(formatted.exitCode).toBe(0);
    }
    const recorded = await Bun.file(fixture).json();

    expect(JSON.parse(JSON.stringify(current))).toEqual(recorded);
  });
});
