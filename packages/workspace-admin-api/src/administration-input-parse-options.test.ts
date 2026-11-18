import { afterAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  type HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { administrationInputParseOptions } from "./administration-input-parse-options";
import { AdminCliCampaignsApi } from "./campaign-operation-endpoints";
import {
  AdminCliAdministrationApi,
  AdministrationAccountId,
  AdministrationActionRecord,
  AdministrationAuthentication,
  AdministrationStandaloneAccessCodeCreateRequest,
  AdministrationStandaloneAccessCodeCreationOutcome,
  CliClientCompatibility,
  CliSessionId,
  CurrentAdministrationCaller,
} from "./workspace-admin-api";
import { WorkspaceAdminApi } from "./workspace-admin-http-api";

type Slot = "payload" | "query" | "success";

/** Every request and response slot an endpoint has, and whether it is strict. */
const slotsOf = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>
) => {
  const slots: Array<{ readonly slot: string; readonly strict: boolean }> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, mergedAnnotations }) => {
      const strict = (key: Context.Key<unknown, unknown>) =>
        Option.getOrUndefined(Context.getOption(mergedAnnotations, key)) ===
        administrationInputParseOptions;
      const present: Record<Slot, boolean> = {
        payload: endpoint.payload.size > 0,
        query: endpoint.query !== undefined,
        success: true,
      };
      const keys: Record<Slot, Context.Key<unknown, unknown>> = {
        payload: HttpApi.PayloadParseOptions,
        query: HttpApi.QueryParseOptions,
        success: HttpApi.SuccessParseOptions,
      };
      for (const slot of ["payload", "query", "success"] as const) {
        if (present[slot]) {
          slots.push({
            slot: `${group.identifier}.${endpoint.identifier} ${slot}`,
            strict: strict(keys[slot]),
          });
        }
      }
    },
  });
  return slots;
};

describe("administration input parse options", () => {
  // The inputs Effect beta.85 decoded strictly through schema annotations,
  // which Effect 4.1 no longer reads; the endpoints now declare them.
  test("apply to exactly the strict administration inputs", () => {
    const strict = slotsOf(WorkspaceAdminApi)
      .filter(({ strict }) => strict)
      .map(({ slot }) => slot)
      .sort();

    expect(strict).toEqual(
      [
        "administration.cancelReservation payload",
        "administration.restoreReservation payload",
        "administration.backfillReservationProductDetails payload",
        "administration.mutateReservationAccess payload",
        "administration.previewInvoice payload",
        "administration.cancelInvoice payload",
        "administration.createInvoice payload",
        "administration.createStandaloneAccessCode payload",
        "administration.createStandaloneAccessCode success",
        "administration.mutateDiscounts payload",
        "campaigns.createCampaignAudience payload",
        "campaigns.updateCampaignAudience payload",
        "campaigns.previewCampaignTemplate payload",
        "campaigns.createCampaign payload",
        "campaigns.updateCampaign payload",
        "campaigns.duplicateCampaign payload",
        "campaigns.testSendCampaign payload",
        "campaigns.sendCampaign payload",
        "campaigns.retryCampaign payload",
        "automations.updateAutomationFlow payload",
        "automations.getAutomationDryRun query",
        "automations.activateAutomation payload",
        "automations.getAutomationRunStats query",
        "automations.listAutomationRuns query",
        "automations.previewCalendarExpression payload",
        "administrators.grantAdministrator payload",
        "administrators.backfillLegacyAdministrator payload",
      ].sort()
    );
  });
});

// Each group's `endpoints` record is typed loosely; these name the declared
// endpoint types.
type AdministrationEndpoint<Name extends string> =
  HttpApiEndpoint.WithIdentifier<
    HttpApiGroup.Endpoints<typeof AdminCliAdministrationApi>,
    Name
  >;
type CampaignsEndpoint<Name extends string> = HttpApiEndpoint.WithIdentifier<
  HttpApiGroup.Endpoints<typeof AdminCliCampaignsApi>,
  Name
>;

const SampleApi = HttpApi.make("strictInputs")
  .add(
    HttpApiGroup.make("administration")
      .add(
        AdminCliAdministrationApi.endpoints
          .createStandaloneAccessCode as AdministrationEndpoint<"createStandaloneAccessCode">
      )
      .add(
        AdminCliAdministrationApi.endpoints
          .mutateDiscounts as AdministrationEndpoint<"mutateDiscounts">
      )
      .add(
        AdminCliAdministrationApi.endpoints
          .renameSession as AdministrationEndpoint<"renameSession">
      )
  )
  .add(
    HttpApiGroup.make("campaigns").add(
      AdminCliCampaignsApi.endpoints
        .previewCampaignTemplate as CampaignsEndpoint<"previewCampaignTemplate">
    )
  );

const attemptId = "01980000-0000-7000-8000-000000000042";
const leakedPin = "1234567";
// A replay that wrongly carries the PIN of the first creation.
const alreadyCreated = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreationOutcome
)({
  outcome: "already-created",
  attemptId,
  providerCredentialId: "provider-credential-id",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T08:00:00Z",
});
if (alreadyCreated.outcome !== "already-created") {
  throw new Error("The replay fixture must be an already-created outcome.");
}
const reached: Array<string> = [];
const reach = (name: string) =>
  Effect.andThen(
    Effect.sync(() => reached.push(name)),
    Effect.die(`${name} reached its handler`)
  );

const passThrough = <A, E, R>(httpEffect: Effect.Effect<A, E, R>) => httpEffect;

const server = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(SampleApi).pipe(
    Layer.provide(
      Layer.mergeAll(
        HttpApiBuilder.group(SampleApi, "administration", (handlers) =>
          handlers
            // A replay that wrongly carries the PIN of the first creation.
            .handle("createStandaloneAccessCode", () =>
              Effect.sync(() => {
                reached.push("createStandaloneAccessCode");
                const replay = { ...alreadyCreated, pin: leakedPin };
                return replay;
              })
            )
            .handle("mutateDiscounts", () => reach("mutateDiscounts"))
            .handle("renameSession", ({ payload }) =>
              Effect.sync(() => {
                reached.push(`renameSession ${JSON.stringify(payload)}`);
                return { changed: true };
              })
            )
        ),
        HttpApiBuilder.group(SampleApi, "campaigns", (handlers) =>
          handlers.handle("previewCampaignTemplate", () =>
            reach("previewCampaignTemplate")
          )
        )
      )
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(AdministrationAuthentication, {
          bearer: (httpEffect) =>
            Effect.provideService(httpEffect, CurrentAdministrationCaller, {
              actor: {
                accountId: AdministrationAccountId.make("account-1"),
                email: testEmailAddress("administrator"),
              },
              channel: {
                _tag: "CliSession",
                sessionId: CliSessionId.make(
                  "01980000-0000-7000-8000-000000000000"
                ),
              },
            }),
        }),
        Layer.succeed(AdministrationActionRecord, passThrough),
        Layer.succeed(CliClientCompatibility, passThrough)
      )
    ),
    Layer.provide(HttpServer.layerServices)
  ),
  { disableLogger: true }
);
afterAll(() => server.dispose());

const send = (method: string, path: string, body: unknown) => {
  reached.length = 0;
  return server.handler(
    new Request(`https://workspace.deskohub.test/api/v1/cli${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer session-token",
      },
      body: JSON.stringify(body),
    })
  );
};

const accessCodeInput = {
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
};
const discountCreation = {
  kind: "create-discount",
  discount: {
    labels: { "cs-CZ": "Léto", "en-US": "Summer" },
    adjustment: { kind: "percentage", basisPoints: 1500 },
    products: [{ kind: "cowork" }],
  },
};

describe("strict administration inputs over HTTP", () => {
  test("refuse a field the input doesn't declare before the handler runs", async () => {
    const response = await send("POST", "/access-codes", {
      attemptId,
      input: accessCodeInput,
      source: "dhw-cli",
    });

    expect(response.status).toBe(400);
    expect(reached).toEqual([]);
  });

  test("refuse an undeclared field nested in the input", async () => {
    const response = await send("POST", "/discounts/mutations", {
      requestId: attemptId,
      mutation: {
        ...discountCreation,
        discount: { ...discountCreation.discount, note: "extra" },
      },
    });

    expect(response.status).toBe(400);
    expect(reached).toEqual([]);
  });

  test("refuse an undeclared field in a member of a union body", async () => {
    const preview = {
      _tag: "Campaign",
      campaignId: "campaign-1",
      locale: "cs-CZ",
    };

    const accepted = await send(
      "POST",
      "/campaign-templates/workspace/preview",
      preview
    );
    const acceptedReached = [...reached];
    const refused = await send(
      "POST",
      "/campaign-templates/workspace/preview",
      { ...preview, extra: true }
    );

    expect([accepted.status, acceptedReached]).toEqual([
      500,
      ["previewCampaignTemplate"],
    ]);
    expect([refused.status, reached]).toEqual([400, []]);
  });

  test("leave a lenient input lenient", async () => {
    const response = await send(
      "PATCH",
      "/sessions/01980000-0000-7000-8000-000000000000",
      { clientName: "laptop", extra: true }
    );

    expect(response.status).toBe(200);
    expect(reached).toEqual(['renameSession {"clientName":"laptop"}']);
  });

  test("never send a PIN with a replayed access-code creation", async () => {
    const response = await send("POST", "/access-codes", {
      attemptId,
      input: accessCodeInput,
    });

    expect(reached).toEqual(["createStandaloneAccessCode"]);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(leakedPin);
  });
});

describe("the typed client's strict administration inputs", () => {
  const client = HttpApiClient.make(SampleApi, {
    baseUrl: "https://workspace.deskohub.test",
  }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        HttpClientRequest.toWeb(
          HttpClientRequest.bearerToken(request, "session-token")
        ).pipe(
          Effect.flatMap((webRequest) =>
            Effect.promise(() => server.handler(webRequest))
          ),
          Effect.map((response) =>
            HttpClientResponse.fromWeb(request, response)
          ),
          Effect.orDie
        )
      )
    )
  );

  test("refuses to send a field the input doesn't declare", async () => {
    reached.length = 0;
    // A value with an extra field still has the payload's static type.
    const payload = {
      ...Schema.decodeUnknownSync(
        AdministrationStandaloneAccessCodeCreateRequest
      )({ attemptId, input: accessCodeInput }),
      source: "dhw-cli",
    };
    const result = await client.pipe(
      Effect.flatMap((api) =>
        api.administration.createStandaloneAccessCode({ payload })
      ),
      Effect.result,
      Effect.runPromise
    );

    expect(result._tag).toBe("Failure");
    expect(reached).toEqual([]);
  });
});
