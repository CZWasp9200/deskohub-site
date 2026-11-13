import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { createMiddlewareChain } from "./middleware-chain";

const fetchEvent = {} as Parameters<
  ReturnType<typeof createMiddlewareChain>
>[1];

describe("createMiddlewareChain", () => {
  it("forwards headers to the app without echoing them to the browser", async () => {
    const chain = createMiddlewareChain([
      (next) => (request, event, response) => {
        const headers = new Headers(request.headers);
        headers.set("x-pathname", "/events");
        return next(Object.assign({}, request, { headers }), event, response);
      },
    ]);

    const response = await chain(
      new NextRequest("https://bar.example.test/cs-CZ/events", {
        method: "POST",
        headers: {
          cookie: "session=secret",
          "content-type": "text/plain;charset=UTF-8",
        },
      }),
      fetchEvent
    );

    // Next.js carries forwarded request headers in `x-middleware-request-*`.
    expect(response?.headers.get("x-middleware-request-x-pathname")).toBe(
      "/events"
    );
    expect(response?.headers.get("cookie")).toBeNull();
    expect(response?.headers.get("content-type")).toBeNull();
    expect(response?.headers.get("x-pathname")).toBeNull();
  });
});
