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

/**
 * What a booking's account section reads, as `start_reservation`'s booking
 * does (`reservation-booking.service.ts`): the section's account is the
 * hold's author, and the booking contact names the customer it books for.
 */
const readBookingSection = CustomerAccountSections.pipe(
  Effect.flatMap((sections) =>
    sections.withOptionalAccount((author) =>
      Effect.all({
        author: Effect.succeed(author),
        held: Effect.serviceOption(HeldCustomerAccount).pipe(
          Effect.map((held) =>
            held._tag === "Some" ? held.value.accountId : null
          )
        ),
        customer: CustomerAccountContactService.pipe(
          Effect.flatMap((contacts) => contacts.current),
          Effect.map((contact) => ({
            accountId: contact?.accountId,
            dotyposCustomerId: contact?.dotyposCustomerId,
          }))
        ),
      })
    )
  )
);

let observed: unknown;

/** A signed-in tool that records what `effect` read. */
const recordingTool = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
  defineSignedInAgentTool({
    name,
    title: name,
    description: name,
    scope: "reservations:create",
    readOnly: true,
    unavailableCode: "reservations_unavailable",
    input: Schema.Struct({ locale: agentToolLocaleField }),
    output: Schema.Struct({}),
    run: () =>
      effect.pipe(
        Effect.orDie,
        Effect.map((reads) => {
          observed = reads;
          return {};
        })
      ),
  });

const tools = [
  recordingTool("read_accounts", readAccountServices),
  recordingTool("book_section", readBookingSection),
];

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
        tools,
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

type ToolName = "read_accounts" | "book_section";

/**
 * Calls the tool as a 2025-era client does: the response streams as soon as
 * the call starts.
 */
const callStreamed = async (name: ToolName) => {
  const response = await answer(
    new Request(resource, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: {} },
      }),
    })
  );
  await response.text();
};

/** Calls the tool as a 2026-era client does: the response is JSON. */
const callAnswered = async (name: ToolName) => {
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
  await client.callTool({ name, arguments: {} });
  await client.close();
};

const callAsAgent = async (
  call: (name: ToolName) => Promise<void>,
  name: ToolName = "read_accounts"
) => {
  observed = undefined;
  stores.lockedAccounts.length = 0;
  stores.profileUpdates.length = 0;
  stores.browserSessionReads.length = 0;
  await call(name);
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
  test("reads every account service through the token without a browser session", async () => {
    stores.signInBrowser(null);

    expect(await callAsAgent(call)).toEqual(readsAsAgent);
    expect(stores.browserSessionReads).toEqual([]);
    expect(stores.profileUpdates).toEqual([agentCustomerId]);
    expect(new Set(stores.lockedAccounts)).toEqual(new Set([agentAccountId]));
  });

  test("reads every account service through the token while the browser is another account's", async () => {
    stores.signInBrowser(browserAccountId);

    expect(await callAsAgent(call)).toEqual(readsAsAgent);
    expect(stores.browserSessionReads).toEqual([]);
    expect(stores.profileUpdates).toEqual([agentCustomerId]);
    expect(new Set(stores.lockedAccounts)).toEqual(new Set([agentAccountId]));
  });

  test("books as the token's account while the browser is another account's", async () => {
    stores.signInBrowser(browserAccountId);

    expect(await callAsAgent(call, "book_section")).toEqual({
      author: agentAccountId,
      held: agentAccountId,
      customer: {
        accountId: agentAccountId,
        dotyposCustomerId: agentCustomerId,
      },
    });
    expect(stores.lockedAccounts).toEqual([agentAccountId]);
    expect(stores.browserSessionReads).toEqual([]);
  });
});
