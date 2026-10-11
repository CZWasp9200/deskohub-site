import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import { Effect, Layer, Logger } from "effect";
import { siteConstants } from "@/shared/utils/constants";

type ResendPayload = { readonly to?: readonly string[] };

const resendPayloads: ResendPayload[] = [];

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: ResendPayload) => {
        resendPayloads.push(payload);
        return { data: { id: `resend-${resendPayloads.length}` } };
      },
    };
    domains = { list: async () => ({ data: [] }) };
  },
}));

// Load after the Resend mock is registered.
const loadContactService = () => import("./contact.service");

const originalVercelEnv = process.env.VERCEL_ENV;

afterAll(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

beforeEach(() => {
  resendPayloads.length = 0;
});

const consoleRecipients = (records: unknown[][]) =>
  records
    .filter(([message]) => message === "Console Email Provider - Sending Email")
    .map(([, facts]) => (facts as { readonly to: readonly string[] }).to);

const submit = async (email: string) => {
  const { ContactService } = await loadContactService();
  const consoleLogs: unknown[][] = [];
  await Effect.gen(function* () {
    const service = yield* ContactService;
    return yield* service.submit(
      { name: "Ada Lovelace", email, phone: "+420777777777", message: "Hello" },
      "en-US"
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ContactService.Default.pipe(
          Layer.provide(
            EmailServiceTag.Live.pipe(
              Layer.provide(
                Layer.succeed(EmailConfigTag, {
                  apiKey: "re_test",
                  defaultFrom: { email: siteConstants.contact.fromEmail },
                })
              )
            )
          )
        ),
        Logger.layer([
          Logger.make((options) => {
            consoleLogs.push(
              Array.isArray(options.message)
                ? options.message
                : [options.message]
            );
          }),
        ])
      )
    ),
    Effect.runPromise
  );
  return consoleRecipients(consoleLogs);
};

describe.each(["preview", "production"])(
  "contact staff notification on %s",
  (environment) => {
    beforeEach(() => {
      process.env.VERCEL_ENV = environment;
    });

    test("a real submitter reaches the real mailbox through Resend", async () => {
      const consoleSends = await submit("ada@example.com");

      expect(resendPayloads.map((payload) => payload.to)).toEqual([
        [siteConstants.contact.contactEmail],
        ["ada@example.com"],
      ]);
      expect(consoleSends).toEqual([]);
    });

    test("a synthetic submitter reaches only the synthetic mailbox through Console", async () => {
      const submitter = "delivered+boardgame-contact-1@resend.dev";
      const consoleSends = await submit(submitter);

      expect(resendPayloads).toEqual([]);
      expect(consoleSends).toEqual([
        ["delivered+boardgame-staff@resend.dev"],
        [submitter],
      ]);
    });
  }
);
