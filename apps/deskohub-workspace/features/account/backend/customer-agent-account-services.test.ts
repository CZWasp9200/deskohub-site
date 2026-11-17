import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import type { CustomerAccountId } from "../customer-account";
import {
  asBrowserRequest,
  fakeAccountServiceStores,
} from "./customer-account-services.test-utils";

const agentAccountId = "agent-account" as CustomerAccountId;

// The agent's account is linked and active, and the account lock is
// recorded instead of reaching Postgres.
const stores = await fakeAccountServiceStores(
  new Map([[agentAccountId, dotyposCustomerIdSchema.make("60111")]])
);
const { lockedAccounts, browserSessionReads } = stores;

const { CustomerAgentAuthorization } = await import(
  "./auth/customer-agent-authorization.service"
);
const { CurrentCustomerAccount } = await import("./current-customer-account");
const { CustomerAccountReservationOwnership } = await import(
  "./customer-account-reservation-ownership"
);
const { CustomerAccountSections } = await import("./customer-account-sections");
const { CustomerAuthentication } = await import(
  "./customer-authentication.service"
);
const { customerAgentAccountServices } = await import(
  "./customer-agent-account-services"
);

const resource = "https://workspace.deskohub.test/api/mcp";
let tokenValid = true;

const authority = CustomerAgentAuthorization.fromAuthority({
  resource,
  validateAccessToken: async () => {
    if (!tokenValid) {
      throw Object.assign(new Error("Revoked"), { name: "APIError" });
    }
    return {
      active: true,
      sub: agentAccountId,
      client_id: "https://assistant.example/oauth-client.json",
      scope: "reservations:read",
      aud: resource,
    };
  },
  findUser: async (id) => ({
    id,
    email: testEmailAddress("agent-account-services"),
    emailVerified: true,
    name: "Agent Customer",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
});

const runAsAgent = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    Layer.Success<ReturnType<typeof customerAgentAccountServices>>
  >
) =>
  effect.pipe(
    Effect.provide(
      customerAgentAccountServices("agent-token").pipe(Layer.provide(authority))
    ),
    Effect.result,
    // A browser request is served, so a read of its session would show.
    asBrowserRequest,
    Effect.runPromise
  );

describe("customerAgentAccountServices", () => {
  test("reads the customer the agent's token acts for", async () => {
    tokenValid = true;
    lockedAccounts.length = 0;
    browserSessionReads.length = 0;

    const result = await runAsAgent(
      Effect.all({
        session: CustomerAuthentication.pipe(
          Effect.flatMap((authentication) => authentication.currentUser)
        ),
        guarded: CustomerAccountSections.pipe(
          Effect.flatMap((sections) =>
            sections.withOptionalAccount((accountId) =>
              Effect.succeed(accountId)
            )
          )
        ),
        standing: CurrentCustomerAccount.pipe(
          Effect.flatMap((current) => current.peek)
        ),
        author: CustomerAccountReservationOwnership.pipe(
          Effect.flatMap((ownership) => ownership.activeAccountId)
        ),
      })
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        session: { accountId: agentAccountId, deletionRequested: false },
        guarded: agentAccountId,
        standing: {
          kind: "linked",
          reviewMarker: "absent",
          account: { accountId: agentAccountId, dotyposCustomerId: "60111" },
        },
        author: agentAccountId,
      },
    });
    expect(lockedAccounts).toEqual([agentAccountId]);
    expect(browserSessionReads).toEqual([]);
  });

  test("fails closed once the token grants nothing", async () => {
    tokenValid = false;
    lockedAccounts.length = 0;
    browserSessionReads.length = 0;

    const guarded = await runAsAgent(
      CustomerAccountSections.pipe(
        Effect.flatMap((sections) =>
          sections.withOptionalAccount((accountId) => Effect.succeed(accountId))
        )
      )
    );
    const author = await runAsAgent(
      CustomerAccountReservationOwnership.pipe(
        Effect.flatMap((ownership) => ownership.activeAccountId)
      )
    );

    expect(guarded).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unauthenticated" },
    });
    expect(author._tag).toBe("Failure");
    expect(lockedAccounts).toEqual([]);
    // Refused by its token, the agent never falls back to the browser's.
    expect(browserSessionReads).toEqual([]);
  });
});
