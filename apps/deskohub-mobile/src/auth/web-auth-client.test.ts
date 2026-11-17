import { afterEach, beforeEach, expect, test } from "bun:test";
import { botProtectedAuthRequests } from "./bot-protection-policy";
import { createWebAuthClient } from "./web-auth-client";

type RecordedRequest = {
  readonly fetch: "at creation" | "after creation";
  readonly path: string;
  readonly method: string;
};

const realFetch = globalThis.fetch;
const requests: Array<RecordedRequest> = [];

/** A stand-in `fetch` that records each request and never leaves the test. */
const recordingFetch = (name: RecordedRequest["fetch"]) =>
  Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({
        fetch: name,
        path: new URL(request.url).pathname,
        method: request.method,
      });
      return new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    { preconnect: realFetch.preconnect }
  );

/** A client created with one `fetch` that BotID then replaces, as on `/app/`. */
const clientWithFetchReplacedAfterCreation = () => {
  globalThis.fetch = recordingFetch("at creation");
  const client = createWebAuthClient("https://workspace.test");
  globalThis.fetch = recordingFetch("after creation");
  return client;
};

beforeEach(() => {
  requests.length = 0;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the sign-in email goes through the fetch BotID installs after creation", async () => {
  const client = clientWithFetchReplacedAfterCreation();

  await client.signIn.magicLink({ email: "customer@example.test" });

  const request = {
    path: "/api/auth/sign-in/magic-link",
    method: "POST",
  } as const;
  expect(botProtectedAuthRequests).toContainEqual(request);
  expect(requests).toEqual([{ fetch: "after creation", ...request }]);
});

test("the code sign-in goes through the fetch BotID installs after creation", async () => {
  const client = clientWithFetchReplacedAfterCreation();

  await client.signIn.emailOtp({
    email: "customer@example.test",
    otp: "123456",
  });

  const request = {
    path: "/api/auth/sign-in/email-otp",
    method: "POST",
  } as const;
  expect(botProtectedAuthRequests).toContainEqual(request);
  expect(requests).toEqual([{ fetch: "after creation", ...request }]);
});
