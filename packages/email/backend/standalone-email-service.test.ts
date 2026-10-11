import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { EmailConfigTag, EmailServiceTag } from "./service";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("EmailServiceTag.Live", () => {
  test("materializes without a Resend key and logs test-recipient mail", async () => {
    process.env.NODE_ENV = "test";

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        const sent = yield* email.send({
          from: { email: "deskohub@example.test" },
          to: { email: "delivered@resend.dev" },
          subject: "Hello",
          text: "Hello",
        });
        return { sent, verified: yield* email.verify };
      }).pipe(
        Effect.provide(
          EmailServiceTag.Live.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                defaultFrom: { email: "deskohub@example.test" },
              })
            )
          )
        )
      )
    );

    expect(result.sent.provider).toBe("console");
    expect(result.verified).toBeFalse();
  });
});
