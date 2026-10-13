import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ValidationError } from "@deskohub/dotypos";
import { Data, Effect, Layer } from "effect";

class SyntheticAvailabilityOutage extends Data.TaggedError(
  "SyntheticAvailabilityOutage"
)<{ readonly message: string }> {}

let availabilityFailure: ValidationError | SyntheticAvailabilityOutage | null =
  null;

mock.module(
  "@/features/reservation/backend/workspace-availability-loader",
  () => ({
    WorkspaceAvailabilityLoaderLive: Layer.empty,
    loadAvailability: () =>
      availabilityFailure
        ? Effect.fail(availabilityFailure)
        : Effect.succeed({ unavailableDates: [] }),
  })
);

const requestUrl =
  "https://workspace.test/api/workspace/availability?kind=cowork";

const loadRoute = async () =>
  (await import("./route")) as {
    GET: (request: Request) => Promise<Response>;
  };

describe("workspace availability route", () => {
  beforeEach(() => {
    availabilityFailure = null;
  });

  test("returns availability without caching it", async () => {
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ unavailableDates: [] });
  });

  test("answers a validation failure with 400 and its message", async () => {
    availabilityFailure = new ValidationError({
      message: "Synthetic availability query is invalid",
    });
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Synthetic availability query is invalid",
    });
  });

  test("answers any other failure with a generic 500", async () => {
    availabilityFailure = new SyntheticAvailabilityOutage({
      message: "synthetic provider outage detail",
    });
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace availability could not be loaded",
    });
  });
});
