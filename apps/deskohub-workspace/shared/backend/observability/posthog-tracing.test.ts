import { describe, expect, test } from "bun:test";
import { createPostHogTracerProvider } from "./posthog-tracing";

describe("PostHog OTel traces", () => {
  test("does not create a tracer provider without a project token", () => {
    expect(
      createPostHogTracerProvider({
        deploymentEnvironment: "preview",
      })
    ).toBeUndefined();
  });

  test("requires the ingest host when tracing is enabled", () => {
    expect(() =>
      createPostHogTracerProvider({
        deploymentEnvironment: "preview",
        posthogProjectToken: "phc_test",
      })
    ).toThrow("POSTHOG_INGEST_HOST is required");
  });
});
