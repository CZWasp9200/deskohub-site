import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import {
  emailTestDomain,
  resendSimulatorAddress,
  testEmailAddress,
} from "@deskohub/email/testing";
import { Effect, Layer, Logger } from "effect";
import { m } from "@/features/i18n/paraglide/messages";
import { siteConstants } from "@/shared/utils/constants";

type ResendPayload = {
  readonly to?: readonly string[];
  readonly subject?: string;
};

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

const originalVercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;

afterAll(() => {
  if (originalVercelEnv === undefined)
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
  else process.env.NEXT_PUBLIC_VERCEL_ENV = originalVercelEnv;
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
            Layer.provideMerge(
              EmailServiceTag.Live,
              Layer.succeed(EmailConfigTag, {
                apiKey: "re_test",
                defaultFrom: { email: siteConstants.contact.fromEmail },
                testDomain: emailTestDomain(),
              })
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

describe.each([
  { environment: "development", subjectTag: "[TESTING] " },
  { environment: "preview", subjectTag: "[TESTING] " },
  { environment: "production", subjectTag: "" },
])(
  "contact staff notification on $environment",
  ({ environment, subjectTag }) => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_VERCEL_ENV = environment;
    });

    test("a real submitter reaches the real mailbox through Resend", async () => {
      // Resend's simulator is a real destination, not a test recipient.
      const submitter = resendSimulatorAddress("delivered", "ada");
      const consoleSends = await submit(submitter);

      expect(resendPayloads.map((payload) => payload.to)).toEqual([
        [siteConstants.contact.contactEmail],
        [submitter],
      ]);
      // Only Production staff copies are untagged.
      expect(resendPayloads[0]?.subject).toBe(
        `${subjectTag}${m["contact.email.businessSubject"](
          { name: "Ada Lovelace" },
          { locale: "cs-CZ" }
        )}`
      );
      expect(consoleSends).toEqual([]);
    });

    test("a synthetic submitter reaches only the synthetic mailbox through Console", async () => {
      const submitter = testEmailAddress("boardgame-contact-1");
      const consoleSends = await submit(submitter);

      expect(resendPayloads).toEqual([]);
      expect(consoleSends).toEqual([
        [testEmailAddress("boardgame-staff")],
        [submitter],
      ]);
    });
  }
);
