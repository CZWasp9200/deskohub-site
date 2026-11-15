import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  asBrowserRequest,
  fakeAccountServiceStores,
} from "@/features/account/backend/customer-account-services.test-utils";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { makeMemoryRequestBudget } from "@/shared/backend/request-budget/memory-request-budget.test-utils";
import { CurrentAgentTraffic } from "@/shared/backend/workspace-request-context";

// The route schedules a traffic event after each call, outside any Next
// request here.
const agentTrafficEvents = await import(
  "@/shared/backend/agent-traffic/agent-traffic-events"
);
mock.module("@/shared/backend/agent-traffic/agent-traffic-events", () => ({
  ...agentTrafficEvents,
  scheduleAgentTrafficEvent: () => Effect.void,
}));

// The services the MCP route builds open the database when built; every
// read below reaches only the faked account stores.
mock.module("@/db/database-provider.server", () => ({
  workspaceDatabaseLayer: Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make({} as never)
  ),
  workspaceDatabasePool: { options: { max: 4 } },
}));

const agentAccountId = "agent-account" as CustomerAccountId;
const agentCustomerId = dotyposCustomerIdSchema.make("60111");
const browserAccountId = "browser-account" as CustomerAccountId;

const stores = await fakeAccountServiceStores(
  new Map([
    [agentAccountId, agentCustomerId],
    [browserAccountId, dotyposCustomerIdSchema.make("60222")],
  ])
);

const { CustomerAgentAuthorization } = await import("@/features/account");
const { CurrentCustomerAccount } = await import(
  "@/features/account/backend/current-customer-account"
);
const { CustomerAccountContactService } = await import(
  "@/features/account/backend/customer-account-contact.service"
);
const { CustomerAccountReservationOwnership } = await import(
  "@/features/account/backend/customer-account-reservation-ownership"
);
const { CustomerAccountSections, HeldCustomerAccount } = await import(
  "@/features/account/backend/customer-account-sections"
);
const { CustomerAuthentication } = await import(
  "@/features/account/backend/customer-authentication.service"
);
const { CustomerProfileService } = await import(
  "@/features/account/backend/customer-profile.service"
);
const { agentToolLocaleField, defineSignedInAgentTool } = await import(
  "./agent-tool"
);
const { AgentToolAdmission } = await import("./agent-tool-admission.service");
const { answerAgentToolMcpRequest } = await import("./agent-tool-mcp-handler");
const { readMcpRequest } = await import("./agent-tool-mcp-messages");
const { CustomerAgentToolsLive } = await import("./customer-agent-tools");

const resource = "https://workspace.deskohub.test/api/mcp";
const accessToken = "agent-token";

/** The agent's token, granting the agent account. */
const tokenAuthority = CustomerAgentAuthorization.fromAuthority({
  resource,
  validateAccessToken: async () => ({
    active: true,
    sub: agentAccountId,
    client_id: "https://assistant.example/oauth-client.json",
    scope: "reservations:create",
    aud: resource,
  }),
  findUser: async (id) => ({
    id,
    email: testEmailAddress("agent-caller"),
    emailVerified: true,
    name: "Agent Customer",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
});

/** The customer account `effect` acts for, or why it refused. */
const actingAccount = <E>(effect: Effect.Effect<string | null, E>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) =>
      result._tag === "Success"
        ? result.success
        : { refused: (result.failure as { reason?: string }).reason }
    )
  );

/**
 * What each account service reached in a signed-in call reads the
 * customer as.
 */
const readAccountServices = Effect.all({
  authentication: actingAccount(
    CustomerAuthentication.pipe(
      Effect.flatMap((authentication) => authentication.currentUser),
      Effect.map((session) => session?.accountId ?? null)
    )
  ),
  optionalSection: actingAccount(
    CustomerAccountSections.pipe(
      Effect.flatMap((sections) =>
        sections.withOptionalAccount((accountId) => Effect.succeed(accountId))
      )
    )
  ),
  sessionSection: actingAccount(
    CustomerAccountSections.pipe(
      Effect.flatMap((sections) =>
        sections.withActiveAccount(
          agentAccountId,
          Effect.map(HeldCustomerAccount, (held) => held.accountId)
        )
      )
    )
  ),
  standing: actingAccount(
    CurrentCustomerAccount.pipe(
      Effect.flatMap((current) => current.peek),
      Effect.map((standing) =>
        "session" in standing ? standing.session.accountId : standing.kind
      )
    )
  ),
  contact: actingAccount(
    CustomerAccountContactService.pipe(
      Effect.flatMap((contacts) => contacts.current),
      Effect.map((contact) => contact?.accountId ?? null)
    )
  ),
  profileUpdate: actingAccount(
    CustomerProfileService.pipe(
      Effect.flatMap((profiles) =>
        profiles.update(
          { accountId: agentAccountId, dotyposCustomerId: agentCustomerId },
          { firstName: "Grace" }
        )
      ),
      // The save holds the account; its lock shows whose.
      Effect.as("saved")
    )
  ),
  reservationAuthor: actingAccount(
    CustomerAccountReservationOwnership.pipe(
      Effect.flatMap((ownership) => ownership.activeAccountId)
    )
  ),
});

let observed: Effect.Success<typeof readAccountServices> | undefined;

/** A signed-in tool that records how its account services read the customer. */
const readAccountsTool = defineSignedInAgentTool({
  name: "read_accounts",
  title: "read_accounts",
  description: "read_accounts",
  scope: "reservations:create",
  readOnly: true,
  unavailableCode: "reservations_unavailable",
  input: Schema.Struct({ locale: agentToolLocaleField }),
  output: Schema.Struct({}),
  run: () =>
    readAccountServices.pipe(
      Effect.map((reads) => {
        observed = reads;
        return {};
      })
    ),
});

/**
 * Answers one MCP request the way the MCP route does: the route's customer
 * tool services are built for a browser request, and the call builds the
 * agent's account services inside them. The route's Effect ends with the
 * response, before its body is read.
 */
const answer = (request: Request) =>
  readMcpRequest(request).pipe(
    Effect.flatMap((mcpRequest) =>
      answerAgentToolMcpRequest({
        tools: [readAccountsTool],
        instructions: "Synthetic instructions.",
        client: "other",
        request: mcpRequest,
      })
    ),
    Effect.provide(
      Layer.mergeAll(
        CustomerAgentToolsLive,
        Layer.succeed(AgentToolAdmission, {
          isCallAllowed: () => Effect.succeed(true),
        }),
        tokenAuthority,
        makeMemoryRequestBudget().layer,
        WorkspaceDatabase.Default
      )
    ),
    Effect.provideService(CurrentAgentTraffic, {
      category: "ai_user_agent",
      name: "claude",
    }),
    asBrowserRequest,
    Effect.runPromise
  );

const callTool = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "read_accounts", arguments: {} },
};

/**
 * Calls the tool as a 2025-era client does: the response streams as soon as
 * the call starts.
 */
const callStreamed = async () => {
  const response = await answer(
    new Request(resource, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify(callTool),
    })
  );
  await response.text();
};

/** Calls the tool as a 2026-era client does: the response is JSON. */
const callAnswered = async () => {
  const client = new Client(
    { name: "agent-caller-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        request.headers.set("authorization", `Bearer ${accessToken}`);
        return answer(request);
      },
    })
  );
  await client.callTool({ name: "read_accounts", arguments: {} });
  await client.close();
};

const callAsAgent = async (call: () => Promise<void>) => {
  observed = undefined;
  stores.lockedAccounts.length = 0;
  stores.profileUpdates.length = 0;
  stores.browserSessionReads.length = 0;
  await call();
  return observed;
};

const readsAsAgent = {
  authentication: agentAccountId,
  optionalSection: agentAccountId,
  sessionSection: agentAccountId,
  standing: agentAccountId,
  contact: agentAccountId,
  profileUpdate: "saved",
  reservationAuthor: agentAccountId,
};

describe.each([
  ["a 2025-era call", callStreamed],
  ["a 2026-era call", callAnswered],
])("%s to a signed-in tool on the MCP route", (_era, call) => {
  // Fails until the agent's account services stop reusing the sections the
  // route's booking services built over the browser session.
  test.failing("reads every account service through the token without a browser session", async () => {
    stores.signInBrowser(null);

    expect(await callAsAgent(call)).toEqual(readsAsAgent);
    expect(stores.browserSessionReads).toEqual([]);
    expect(stores.profileUpdates).toEqual([agentCustomerId]);
    expect(new Set(stores.lockedAccounts)).toEqual(new Set([agentAccountId]));
  });

  test.failing("reads every account service through the token while the browser is another account's", async () => {
    stores.signInBrowser(browserAccountId);

    expect(await callAsAgent(call)).toEqual(readsAsAgent);
    expect(stores.browserSessionReads).toEqual([]);
    expect(stores.profileUpdates).toEqual([agentCustomerId]);
    expect(new Set(stores.lockedAccounts)).toEqual(new Set([agentAccountId]));
  });
});
