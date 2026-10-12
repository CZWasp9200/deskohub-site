import { describe, expect, mock, test } from "bun:test";
import {
  EmailConfigTag,
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email";
import { emailTestDomain, testEmailAddress } from "@deskohub/email/testing";
import { Effect, Layer } from "effect";
import { m } from "@/features/i18n/paraglide/messages";
import { siteConstants } from "@/shared/utils/constants";
import { ContactService } from "./contact.service";

const input = {
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420777777777",
  message: "Hello",
};

const sent = (id: string): EmailSendResult => ({
  id: EmailDeliveryIdSchema.make(id),
  status: "sent",
  provider: "fake",
  timestamp: new Date("2026-06-20T12:00:00.000Z"),
});

const runSubmit = (
  send: ReturnType<typeof mock>,
  locale: "en-US" | "cs-CZ" = "en-US"
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ContactService;
      return yield* service.submit(input, locale);
    }).pipe(
      Effect.provide(
        ContactService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, {
                send,
                sendTemplate: mock(() => Effect.succeed(sent("template"))),
                verify: Effect.succeed(true),
              }),
              Layer.succeed(EmailConfigTag, {
                defaultFrom: { email: siteConstants.contact.fromEmail },
                testDomain: emailTestDomain(),
              })
            )
          )
        )
      )
    )
  );

describe("ContactService", () => {
  test("first send failure rejects with send failure message", async () => {
    const send = mock(() => Effect.fail(new EmailServiceError("nope")));

    await expect(runSubmit(send)).rejects.toThrow(
      "Failed to send message. Please try again later."
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("confirmation send failure does not fail submission", async () => {
    let calls = 0;
    const send = mock(() =>
      calls++ === 0
        ? Effect.succeed(sent("business"))
        : Effect.fail(new EmailServiceError("confirmation failed"))
    );

    const result = await runSubmit(send);

    expect(result).toMatchObject({ ...input, locale: "en-US" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("customer confirmation follows the typed locale; business email stays cs-CZ", async () => {
    // Production staff copies carry no test tag.
    const originalVercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    const messages: EmailMessage[] = [];
    const send = mock((message: EmailMessage) => {
      messages.push(message);
      return Effect.succeed(sent(`msg-${messages.length}`));
    });

    const result = await runSubmit(send, "cs-CZ").finally(() => {
      if (originalVercelEnv === undefined) {
        delete process.env.NEXT_PUBLIC_VERCEL_ENV;
      } else process.env.NEXT_PUBLIC_VERCEL_ENV = originalVercelEnv;
    });

    expect(result.locale).toBe("cs-CZ");
    const business = messages[0];
    const confirmation = messages[1];
    expect(business?.subject).toBe(
      m["contact.email.businessSubject"](
        { name: input.name },
        { locale: "cs-CZ" }
      )
    );
    expect(confirmation?.subject).toBe(
      m["contact.email.confirmationSubject"](undefined, { locale: "cs-CZ" })
    );
  });
});
