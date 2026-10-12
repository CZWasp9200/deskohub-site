import { describe, expect, test } from "bun:test";
import { Config, ConfigProvider, Effect } from "effect";
import { testEmailAddress } from "../testing/test-email-address";
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
      )
    )
  );

describe("makeEmailConfigLayer", () => {
  test("decodes the sender and Resend key", async () => {
    expect(await readConfig({ EMAIL_API_KEY: "re_test" })).toEqual({
      defaultFrom: { email: testEmailAddress("deskohub") },
      apiKey: "re_test",
    });
  });

  test("leaves the Resend key undefined when it is not configured", async () => {
    expect(await readConfig({})).toEqual({
      defaultFrom: { email: testEmailAddress("deskohub") },
      apiKey: undefined,
    });
  });
});
