import { afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { EmailProviderConfig } from "../types/email.types";
import { ConfiguredEmailProviderLayer } from "./provider-factory";
import { EmailConfigTag, EmailProviderTag } from "./service";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const config: EmailProviderConfig = {
  provider: "console" as const,
  defaultFrom: { email: testEmailAddress("deskohub") },
};

const providerName = (overrides: Partial<EmailProviderConfig> = {}) =>
  Effect.runPromise(
    EmailProviderTag.pipe(
      Effect.map((provider) => provider.name),
      Effect.provide(
        ConfiguredEmailProviderLayer.pipe(
          Layer.provide(
            Layer.succeed(EmailConfigTag, { ...config, ...overrides })
          )
        )
      )
    )
  );

describe("ConfiguredEmailProviderLayer", () => {
  test("fails for the console provider in production", async () => {
    process.env.NODE_ENV = "production";

    expect(await providerName({ apiKey: "api-key" })).toBe("resend");

    const consoleResult = await Effect.runPromise(
      EmailProviderTag.pipe(
        Effect.provide(
          ConfiguredEmailProviderLayer.pipe(
            Layer.provide(Layer.succeed(EmailConfigTag, config))
          )
        ),
        Effect.result
      )
    );
    expect(consoleResult._tag).toBe("Failure");
  });

  test("allows console provider in Vercel preview production builds", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";

    expect(await providerName({ apiKey: "api-key" })).toBe("console");
  });
});
