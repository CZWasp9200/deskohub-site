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

const { isTestEmailRecipient, RoutedEmailProviderLive, routeEmailMessage } =
  await import("./email-routing");
const { EmailConfigTag, EmailProviderTag } = await import("./capabilities");

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
});

const testRecipient = { email: "delivered+run7f3a2b-signin@resend.dev" };
const realRecipient = { email: "ada@example.test" };

const message = (to: { email: string } | { email: string }[]) => ({
  from: { email: "deskohub@example.test" },
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
              defaultFrom: { email: "deskohub@example.test" },
            })
          )
        )
      ),
      Effect.result
    )
  );

describe("isTestEmailRecipient", () => {
  test("accepts any address on the Resend test domain", () => {
    expect(isTestEmailRecipient("delivered@resend.dev")).toBe(true);
    expect(isTestEmailRecipient(testRecipient.email)).toBe(true);
    expect(isTestEmailRecipient(" Delivered+Workspace@RESEND.DEV ")).toBe(true);
  });

  test("rejects real and look-alike domains", () => {
    expect(isTestEmailRecipient("ada@example.test")).toBe(false);
    expect(isTestEmailRecipient("ada@gmail.com")).toBe(false);
    expect(isTestEmailRecipient("ada@resend.dev.evil.test")).toBe(false);
    expect(isTestEmailRecipient("ada@notresend.dev")).toBe(false);
    expect(isTestEmailRecipient("")).toBe(false);
  });
});

describe("routeEmailMessage", () => {
  test("routes mail for test recipients only to Console", () => {
    expect(routeEmailMessage({ to: testRecipient })).toBe("console");
    expect(
      routeEmailMessage({
        to: [testRecipient, { email: "delivered+internal@resend.dev" }],
      })
    ).toBe("console");
  });

  test("routes mail reaching any real recipient to Resend", () => {
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
