import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger } from "effect";

type SendImplementation = (payload?: {
  readonly subject?: string;
}) => Promise<{ readonly data: { id: string } }>;

let resendSend = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: (payload?: { readonly subject?: string }) => resendSend(payload),
    };
    domains = { list: async () => ({ data: [] }) };
  },
}));

const {
  internalRecipientForOrigin,
  RoutedEmailProviderLive,
  routeEmailMessage,
  staffEmailSubject,
} = await import("./email-routing");
const { EmailConfigTag, EmailProviderTag } = await import("./capabilities");
const { isTestEmailRecipient } = await import("./test-recipients");
const { resendSimulatorAddress, testEmailAddress } = await import(
  "@deskohub/test-email"
);

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
});

const testRecipient = { email: testEmailAddress("ada") };
// Resend's simulator is a real destination, never a test recipient.
const realRecipient = { email: resendSimulatorAddress("delivered", "ada") };
const sender = { email: testEmailAddress("deskohub") };

const message = (
  to: { email: string } | { email: string }[],
  subject = "Hello"
) => ({
  from: sender,
  to,
  subject,
  text: "Hello",
});

/** Sends one message through the routed provider, capturing its log output. */
const sendRouted = async (
  to: { email: string } | { email: string }[],
  apiKey?: string,
  subject?: string
) => {
  const logMessages: unknown[] = [];
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* EmailProviderTag;
      return yield* provider.send(message(to, subject));
    }).pipe(
      Effect.provide(
        RoutedEmailProviderLive.pipe(
          Layer.provide(
            Layer.succeed(EmailConfigTag, {
              apiKey,
              defaultFrom: sender,
            })
          )
        )
      ),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logMessages.push(options.message);
          }),
        ])
      ),
      Effect.result
    )
  );
  return Object.assign(result, { logged: JSON.stringify(logMessages) });
};

describe("isTestEmailRecipient", () => {
  test("accepts any address on the test domain", () => {
    expect(isTestEmailRecipient(testRecipient.email)).toBe(true);
    expect(
      isTestEmailRecipient(` ${testEmailAddress("Workspace").toUpperCase()} `)
    ).toBe(true);
  });

  test("rejects Resend simulator, look-alike, and empty addresses", () => {
    for (const outcome of ["delivered", "bounced", "complained"] as const) {
      expect(isTestEmailRecipient(resendSimulatorAddress(outcome))).toBe(false);
    }
    expect(isTestEmailRecipient(`${testRecipient.email}.evil`)).toBe(false);
    expect(isTestEmailRecipient(testRecipient.email.replace("@", "@not"))).toBe(
      false
    );
    expect(isTestEmailRecipient("")).toBe(false);
  });
});

describe("routeEmailMessage", () => {
  test("routes mail for test recipients only to Console", () => {
    expect(routeEmailMessage({ to: testRecipient })).toBe("console");
    expect(
      routeEmailMessage({
        to: [testRecipient, { email: testEmailAddress("internal") }],
      })
    ).toBe("console");
  });

  test("routes mail reaching any other recipient to Resend", () => {
    expect(routeEmailMessage({ to: realRecipient })).toBe("resend");
    expect(routeEmailMessage({ to: [testRecipient, realRecipient] })).toBe(
      "resend"
    );
    expect(routeEmailMessage({ to: testRecipient, cc: realRecipient })).toBe(
      "resend"
    );
    expect(routeEmailMessage({ to: testRecipient, bcc: [realRecipient] })).toBe(
      "resend"
    );
  });
});

describe("internalRecipientForOrigin", () => {
  const mailbox = {
    real: {
      email: resendSimulatorAddress("delivered", "staff"),
      name: "Staff",
    },
    testLocalPart: "staff",
  };

  test("keeps staff copies of test-recipient requests on the test domain", () => {
    expect(internalRecipientForOrigin(testRecipient.email, mailbox)).toEqual({
      email: testEmailAddress("staff"),
      name: "Staff",
    });
  });

  test("sends staff copies of other requests to the real mailbox", () => {
    expect(internalRecipientForOrigin(realRecipient.email, mailbox)).toBe(
      mailbox.real
    );
  });
});

describe("staffEmailSubject", () => {
  test("tags staff copies outside production", () => {
    expect(staffEmailSubject("New request", { isProduction: false })).toBe(
      "[TESTING] New request"
    );
  });

  test("leaves production staff copies untagged", () => {
    expect(staffEmailSubject("New request", { isProduction: true })).toBe(
      "New request"
    );
  });
});

describe("RoutedEmailProviderLive", () => {
  test("logs test-recipient mail through Console without a Resend key", async () => {
    const result = await sendRouted(testRecipient);

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("console");
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("delivers real-recipient mail through Resend", async () => {
    const result = await sendRouted(realRecipient, "re_test");

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("resend");
    }
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  test("keeps test-recipient mail on Console when a Resend key exists", async () => {
    const result = await sendRouted(testRecipient, "re_test");

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("console");
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("logs every message through Console without a Resend key", async () => {
    for (const apiKey of [undefined, "", "   "]) {
      for (const to of [realRecipient, [testRecipient, realRecipient]]) {
        const result = await sendRouted(to, apiKey);

        expect(result._tag).toBe("Success");
        if (result._tag === "Success") {
          expect(result.success.provider).toBe("console");
        }
      }
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("keeps the test tag on staff copies outside production on both providers", async () => {
    const subject = staffEmailSubject("New request", { isProduction: false });

    const routedToConsole = await sendRouted(realRecipient, undefined, subject);
    expect(routedToConsole._tag).toBe("Success");
    expect(routedToConsole.logged).toContain("[TESTING] New request");

    const routedToResend = await sendRouted(realRecipient, "re_test", subject);
    expect(routedToResend._tag).toBe("Success");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0]?.[0]?.subject).toBe(
      "[TESTING] New request"
    );
  });
});
