import { describe, expect, test } from "bun:test";
import { Config, ConfigProvider, Effect } from "effect";
import {
  emailTestDomain,
  testEmailAddress,
} from "../testing/test-email-address";
import { EmailConfigTag } from "./capabilities";
import { makeEmailConfigLayer } from "./email-config";

const readConfig = (env: Record<string, string>) =>
  Effect.runPromise(
    EmailConfigTag.pipe(
      Effect.provide(
        makeEmailConfigLayer(
          Config.succeed({ email: testEmailAddress("deskohub") })
        )
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env)
      ),
      Effect.result
    )
  );

describe("makeEmailConfigLayer", () => {
  test("decodes the test domain next to the Resend key", async () => {
    const result = await readConfig({
      EMAIL_API_KEY: "re_test",
      EMAIL_TEST_DOMAIN: emailTestDomain(),
    });

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success).toEqual({
        defaultFrom: { email: testEmailAddress("deskohub") },
        apiKey: "re_test",
        testDomain: emailTestDomain(),
      });
    }
  });

  test("fails closed without a test domain", async () => {
    const result = await readConfig({ EMAIL_API_KEY: "re_test" });

    expect(result._tag).toBe("Failure");
  });

  test.each([
    ["Resend's simulator domain", "resend.dev"],
    ["a Resend simulator subdomain", "mail.resend.dev"],
    ["an uppercase domain", "Deskohub.Test"],
    ["a bare label", "localhost"],
    ["an address", "ops@deskohub"],
    ["an empty value", ""],
  ])("rejects %s", async (_case, domain) => {
    const result = await readConfig({ EMAIL_TEST_DOMAIN: domain });

    expect(result._tag).toBe("Failure");
  });
});
