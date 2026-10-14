import { describe, expect, test } from "bun:test";
import { Data, Effect } from "effect";
import { defineWorkspaceRoute, WorkspaceRouteFailure } from "./workspace-route";

class TestLayerError extends Data.TaggedError("TestLayerError")<{
  readonly message: string;
}> {}

describe("Workspace routes", () => {
  test("recovers typed failures without exposing their cause", async () => {
    const cause = new TestLayerError({ message: "private setup" });
    const GET = defineWorkspaceRoute(
      {
        operation: "test.failure",
        cancellation: "continue-after-disconnect",
      },
      () =>
        Effect.fail(
          new WorkspaceRouteFailure({
            statusCode: 503,
            publicMessage: "Temporarily unavailable",
            cause,
          })
        ).pipe(Effect.as(new Response("unused")))
    );

    const response = await GET(new Request("https://deskohub.test"));
    const body = await response.clone().text();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Temporarily unavailable",
    });
    expect(body).not.toContain("private setup");
  });

  test("uses the request signal only when interruption is declared", async () => {
    const controller = new AbortController();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const interrupted = defineWorkspaceRoute(
      {
        operation: "test.interrupt",
        cancellation: "interrupt-on-disconnect",
      },
      () => Effect.sync(markStarted).pipe(Effect.andThen(Effect.never))
    );
    const request = new Request("https://deskohub.test", {
      signal: controller.signal,
    });
    const result = interrupted(request);
    await started;
    controller.abort();

    await expect(result).rejects.toBeDefined();

    const continued = defineWorkspaceRoute(
      {
        operation: "test.continue",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("continued"))
    );
    await expect((await continued(request)).text()).resolves.toBe("continued");
  });
});
