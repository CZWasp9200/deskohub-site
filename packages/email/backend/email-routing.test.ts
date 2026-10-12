import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";

type SendImplementation = () => Promise<{ readonly data: { id: string } }>;

let resendSend = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: (...args: []) => resendSend(...args) };
    domains = { list: async () => ({ data: [] }) };
  },
}));

const {
  internalRecipientForOrigin,
  isTestEmailRecipient,
  RoutedEmailProviderLive,
  routeEmailMessage,
  staffEmailSubject,
} = await import("./email-routing");
const { EmailConfigTag, EmailProviderTag } = await import("./capabilities");
const { emailTestDomain, resendSimulatorAddress, testEmailAddress } =
  await import("../testing/test-email-address");

const testDomain = emailTestDomain();

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
});

const testRecipient = { email: testEmailAddress("ada") };
// Resend's simulator is a real destination, never a test recipient.
const realRecipient = { email: resendSimulatorAddress("delivered", "ada") };
const sender = { email: testEmailAddress("deskohub") };

const message = (to: { email: string } | { email: string }[]) => ({
  from: sender,
  to,
  subject: "Hello",
  text: "Hello",
});

const sendRouted = (
  to: { email: string } | { email: string }[],
  apiKey?: string
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* EmailProviderTag;
      return yield* provider.send(message(to));
    }).pipe(
      Effect.provide(
        RoutedEmailProviderLive.pipe(
          Layer.provide(
            Layer.succeed(EmailConfigTag, {
              apiKey,
              defaultFrom: sender,
              testDomain,
            })
          )
        )
      ),
      Effect.result
    )
  );

describe("isTestEmailRecipient", () => {
  test("accepts any address on the test domain", () => {
    expect(isTestEmailRecipient(testRecipient.email, testDomain)).toBe(true);
    expect(
      isTestEmailRecipient(
        ` ${testEmailAddress("Workspace").toUpperCase()} `,
        testDomain
      )
    ).toBe(true);
  });

  test("rejects Resend simulator, look-alike, and empty addresses", () => {
    for (const outcome of ["delivered", "bounced", "complained"] as const) {
      expect(
        isTestEmailRecipient(resendSimulatorAddress(outcome), testDomain)
      ).toBe(false);
    }
    expect(
      isTestEmailRecipient(`${testRecipient.email}.evil`, testDomain)
    ).toBe(false);
    expect(
      isTestEmailRecipient(testRecipient.email.replace("@", "@not"), testDomain)
    ).toBe(false);
    expect(isTestEmailRecipient("", testDomain)).toBe(false);
  });
});

describe("routeEmailMessage", () => {
  test("routes mail for test recipients only to Console", () => {
    expect(routeEmailMessage({ to: testRecipient }, testDomain)).toBe(
      "console"
    );
    expect(
      routeEmailMessage(
        { to: [testRecipient, { email: testEmailAddress("internal") }] },
        testDomain
      )
    ).toBe("console");
  });

  test("routes mail reaching any other recipient to Resend", () => {
    expect(routeEmailMessage({ to: realRecipient }, testDomain)).toBe("resend");
    expect(
      routeEmailMessage({ to: [testRecipient, realRecipient] }, testDomain)
    ).toBe("resend");
    expect(
      routeEmailMessage({ to: testRecipient, cc: realRecipient }, testDomain)
    ).toBe("resend");
    expect(
      routeEmailMessage({ to: testRecipient, bcc: [realRecipient] }, testDomain)
    ).toBe("resend");
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
    expect(
      internalRecipientForOrigin(testRecipient.email, testDomain, mailbox)
    ).toEqual({ email: testEmailAddress("staff"), name: "Staff" });
  });

  test("sends staff copies of other requests to the real mailbox", () => {
    expect(
      internalRecipientForOrigin(realRecipient.email, testDomain, mailbox)
    ).toBe(mailbox.real);
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

  test("fails closed for a real recipient without a Resend key", async () => {
    for (const apiKey of [undefined, "", "   "]) {
      const result = await sendRouted(realRecipient, apiKey);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("EmailDeliveryUnconfiguredError");
      }
    }
    expect(resendSend).not.toHaveBeenCalled();
  });
});
