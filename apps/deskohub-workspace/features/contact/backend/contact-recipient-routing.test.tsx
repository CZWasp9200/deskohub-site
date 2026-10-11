import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger } from "effect";
import * as envModule from "@/env";
import { workspaceSiteConstants } from "@/shared/utils";

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

// The workspace env object is read once at import; route VERCEL_ENV through a
// switchable override so one file covers Preview and Production.
let vercelEnv: string | undefined;
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "VERCEL_ENV" && vercelEnv !== undefined
        ? vercelEnv
        : Reflect.get(target, key),
  }),
}));

const { EmailConfigTag, EmailServiceTag } = await import(
  "@deskohub/email/backend/service"
);
const { ContactService } = await import("./contact.service");

afterAll(() => {
  vercelEnv = undefined;
});

beforeEach(() => {
  resendPayloads.length = 0;
});

const consoleRecipients = (records: unknown[][]) =>
  records
    .filter(([message]) => message === "Console Email Provider - Sending Email")
    .map(([, facts]) => (facts as { readonly to: readonly string[] }).to);

const submit = (email: string) => {
  const consoleLogs: unknown[][] = [];
  return Effect.gen(function* () {
    const service = yield* ContactService;
    return yield* service.submit(
      {
        name: "Ada Lovelace",
        email,
        phone: "+420 123 456 789",
        message: "Please help with a workspace reservation.",
      },
      "en-US"
    );
  }).pipe(
    Effect.provide(
      ContactService.Default.pipe(
        Layer.provide(
          Layer.provideMerge(
            EmailServiceTag.Live,
            Layer.succeed(EmailConfigTag, {
              apiKey: "re_test",
              defaultFrom: { email: "reservations@workspace.deskohub.cz" },
            })
          )
        )
      )
    ),
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          consoleLogs.push([...options.message]);
        }),
      ])
    ),
    Effect.runPromise,
    (promise) => promise.then(() => consoleRecipients(consoleLogs))
  );
};

describe.each(["preview", "production"])(
  "contact staff notification on %s",
  (environment) => {
    beforeEach(() => {
      vercelEnv = environment;
    });

    test("a real submitter reaches the real mailbox through Resend", async () => {
      const consoleSends = await submit("ada@example.com");

      expect(resendPayloads.map((payload) => payload.to)).toEqual([
        [workspaceSiteConstants.contact.infoEmail],
        ["ada@example.com"],
      ]);
      expect(consoleSends).toEqual([]);
    });

    test("a synthetic submitter reaches only the synthetic mailbox through Console", async () => {
      const submitter = "delivered+workspace-e2e-contact-1@resend.dev";
      const consoleSends = await submit(submitter);

      expect(resendPayloads).toEqual([]);
      expect(consoleSends).toEqual([
        ["delivered+workspace-internal@resend.dev"],
        [submitter],
      ]);
    });
  }
);
