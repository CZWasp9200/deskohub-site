import { describe, expect, test } from "bun:test";
import { EmailConfigTag } from "@deskohub/email";
import { emailTestDomain } from "@deskohub/email/testing";
import { ConfigProvider, Effect } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";
import { EmailConfigLayer, workspaceDefaultFromAddress } from "./email.config";

const readConfig = (env: Record<string, string>) =>
  Effect.runPromise(
    EmailConfigTag.pipe(
      Effect.provide(EmailConfigLayer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env)
      )
    )
  );

describe("EmailConfigLayer", () => {
  test("reads the test domain and no API key when none is configured", async () => {
    const config = await readConfig({ EMAIL_TEST_DOMAIN: emailTestDomain() });

    expect(config).toEqual({
      defaultFrom: {
        email: workspaceDefaultFromAddress,
        name: workspaceSiteConstants.brand.name,
      },
      apiKey: undefined,
      testDomain: emailTestDomain(),
    });
  });

  test("reads the Resend API key", async () => {
    const config = await readConfig({
      EMAIL_API_KEY: "api-key",
      EMAIL_TEST_DOMAIN: emailTestDomain(),
    });

    expect(config).toMatchObject({ apiKey: "api-key" });
  });

  test("fails closed without a test domain", async () => {
    await expect(readConfig({ EMAIL_API_KEY: "api-key" })).rejects.toThrow();
  });
});
