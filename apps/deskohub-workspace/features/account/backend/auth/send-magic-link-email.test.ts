import "@/shared/testing/workspace-test-environment";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ConfigProvider, Effect, Predicate, Tracer } from "effect";

mock.module("server-only", () => ({}));

type SendPayload = {
  from?: string;
  to?: readonly string[];
  subject?: string;
  html?: string;
  text?: string;
  tags?: readonly { name: string; value: string }[];
};
type SendResponse =
  | { readonly data: { readonly id: string }; readonly error?: never }
  | {
      readonly data?: never;
      readonly error: {
        readonly message: string;
        readonly statusCode?: number;
      };
    };
type SendImplementation = (
  payload?: SendPayload,
  options?: { readonly idempotencyKey?: string }
) => Promise<SendResponse>;

let resendSend = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
    domains = { list: async () => ({ data: [] }) };
  },
}));

const { MagicLinkDeliveryTransportError, makeMagicLinkEmailDelivery } =
  await import("./send-magic-link-email");
const {
  isSyntheticE2EEmailRecipient,
  magicLinkPreviewE2ELogCode,
  magicLinkSyntheticRecipientPattern,
} = await import("./magic-link-policy");

const request = {
  email: "ada@example.test",
  url: "https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  locale: "en-US" as const,
};

const syntheticRequest = {
  ...request,
  email: "delivered+run7f3a2b-signin@resend.dev",
};

/** A test recipient outside the synthetic E2E account shape. */
const testRecipientRequest = {
  ...request,
  email: "delivered@resend.dev",
};

const renderOk = () =>
  Effect.succeed({
    subject: "Sign in",
    html: "<p>Sign in link</p>",
    text: "Sign in at https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  });

const previewEnvironment = { isVercelPreview: true } as const;
const productionEnvironment = { isVercelPreview: false } as const;

const resendEmailConfig = {
  EMAIL_API_KEY: "re_test",
};

/**
 * Runs one delivery with an explicit `EmailConfigLayer` configuration. The
 * shared default ConfigProvider snapshots the environment on first read, so
 * tests inject the provider per run instead of mutating `process.env`.
 */
const runDeliver = <A>(
  emailConfig: Record<string, string>,
  effect: Effect.Effect<A>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(emailConfig)
      )
    )
  );

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;

const captureConsole = (): string[] & { restore: () => void } => {
  const lines: string[] = [];
  // biome-ignore lint/suspicious/noConsole: The test captures the authorized console delivery channel.
  const original = consoleMethods.map((method) => console[method]);
  const capture = (...args: unknown[]) => {
    lines.push(
      args
        .map((arg) =>
          Predicate.isString(arg) ? arg : (JSON.stringify(arg) ?? "")
        )
        .join(" ")
    );
  };
  for (const method of consoleMethods) {
    console[method] = capture;
  }

  const captured = lines as string[] & { restore: () => void };
  captured.restore = () => {
    consoleMethods.forEach((method, index) => {
      // biome-ignore lint/suspicious/noConsole: The test restores the captured console channels.
      console[method] = original[index] ?? console[method];
    });
  };
  return captured;
};

const previewE2ELines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes(magicLinkPreviewE2ELogCode));

const makeSpanNameCaptureTracer = (names: string[]) => {
  let nextSpanId = 0;
  return Tracer.make({
    span: (options) => {
      names.push(options.name);
      const startTime = options.startTime;
      let status: Tracer.SpanStatus = { _tag: "Started", startTime };
      const attributes = new Map<string, unknown>();
      const links = [...options.links];
      return {
        _tag: "Span",
        name: options.name,
        spanId: `span-${++nextSpanId}`,
        traceId: "trace-test",
        parent: options.parent,
        annotations: options.annotations,
        get status() {
          return status;
        },
        attributes,
        links,
        sampled: options.sampled,
        kind: options.kind,
        end(endTime, exit) {
          status = { _tag: "Ended", startTime, endTime, exit };
        },
        attribute(key, value) {
          attributes.set(key, value);
        },
        event() {},
        addLinks(newLinks) {
          links.push(...newLinks);
        },
      } satisfies Tracer.Span;
    },
  });
};

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
});

describe("Recipient-based provider routing", () => {
  test("delivers a real recipient through Resend", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
    const payload = resendSend.mock.calls[0]?.[0];
    expect(payload?.to).toEqual([request.email]);
    expect(payload?.subject).toBe("Sign in");
    expect(payload?.html).toContain("Sign in link");
    expect(payload?.text).toContain(request.url);
    expect(payload?.tags).toEqual([
      { name: "category", value: "account-magic-link" },
      { name: "surface", value: "workspace" },
    ]);
    expect(previewE2ELines(consoleLines)).toEqual([]);
  });

  test("suppresses bearer content via the sensitiveContent marker for other test recipients", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          testRecipientRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    const logged = consoleLines.join("\n");
    expect(logged).toContain('"sensitive":true');
    expect(logged).not.toContain(testRecipientRequest.email);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("Sign in");
    expect(logged).not.toContain("EMAIL CONTENT");
    expect(previewE2ELines(consoleLines)).toEqual([]);
  });
});

describe("Synthetic Preview delivery through the shared Console provider", () => {
  test("emits exactly one E2E text log line and zero Resend sends without a Resend key", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        {},
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          syntheticRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();

    const e2eLines = previewE2ELines(consoleLines);
    expect(e2eLines).toHaveLength(1);
    const parsed = JSON.parse(e2eLines[0]!) as {
      code?: unknown;
      message?: unknown;
      recipient?: unknown;
      text?: unknown;
    };
    expect(Object.keys(parsed).sort()).toEqual([
      "code",
      "message",
      "recipient",
      "text",
    ]);
    expect(parsed.code).toBe(magicLinkPreviewE2ELogCode);
    expect(parsed.recipient).toBe(syntheticRequest.email);
    expect(parsed.text).toContain(syntheticRequest.url);
    expect(parsed.text).not.toContain("<p>");
    expect(e2eLines[0]).toContain(syntheticRequest.url);
    expect(e2eLines[0]).not.toContain("<p>");
    expect(e2eLines[0]).not.toContain("\n");
    expect(consoleLines.join("\n")).not.toContain("EMAIL CONTENT");
  });

  test("keeps synthetic recipients on Console when a Resend key exists", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          syntheticRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    expect(previewE2ELines(consoleLines)).toHaveLength(1);
  });

  test("real Preview recipients go to Resend with no E2E line", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(previewE2ELines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain("secret-token");
    expect(consoleLines.join("\n")).not.toContain(request.email);
  });

  test("synthetic recipients outside Preview stay on Console with no E2E line", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          syntheticRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    expect(previewE2ELines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain("secret-token");
    expect(consoleLines.join("\n")).not.toContain(syntheticRequest.email);
  });
});

describe("Errors and log safety", () => {
  test("reports provider rejection with the fixed censored code and no provider detail", async () => {
    resendSend = mock<SendImplementation>(async () => ({
      error: { message: "quota exceeded for api key", statusCode: 429 },
    }));
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-rejected");
    const logged = consoleLines.join("\n");
    expect(logged).not.toContain("quota exceeded");
    expect(logged).not.toContain(request.email);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("Sign in");
  });

  test("reports transport failures without leaking after shared-service retries", async () => {
    resendSend = mock<SendImplementation>(async () => {
      throw new Error("network failure with secret detail");
    });
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-failed");
    expect(resendSend.mock.calls.length).toBeGreaterThan(1);
    const logged = consoleLines.join("\n");
    expect(logged).not.toContain("network failure");
    expect(logged).not.toContain(request.email);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("Sign in");
  }, 20_000);

  test("reports renderer failures without leaking the message", async () => {
    const code = await runDeliver(
      resendEmailConfig,
      makeMagicLinkEmailDelivery(
        () => Effect.fail(new Error("render exploded with secret-token")),
        productionEnvironment
      ).deliver(request)
    );

    expect(code).toBe("account.magic-link.delivery-failed");
  });

  test("fails with an account-owned tagged transport error", () => {
    const transport = new MagicLinkDeliveryTransportError();

    expect(transport._tag).toBe("MagicLinkDeliveryTransportError");
    expect(transport).toBeInstanceOf(Error);
  });

  test("fails closed as unconfigured for a real recipient without a Resend key", async () => {
    for (const environment of [productionEnvironment, previewEnvironment]) {
      const consoleLines = captureConsole();
      let code: string | undefined;
      try {
        code = await runDeliver(
          {},
          makeMagicLinkEmailDelivery(renderOk, environment).deliver(request)
        );
      } finally {
        consoleLines.restore();
      }

      expect(code).toBe("account.magic-link.delivery-unconfigured");
      const logged = consoleLines.join("\n");
      expect(logged).not.toContain(request.email);
      expect(logged).not.toContain("secret-token");
      expect(previewE2ELines(consoleLines)).toEqual([]);
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("never logs the recipient, bearer URL, or token on the accepted path", async () => {
    const consoleLines = captureConsole();
    try {
      const code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          request
        )
      );
      expect(code).toBe("account.magic-link.delivery-accepted");
    } finally {
      consoleLines.restore();
    }

    const logged = consoleLines.join("\n");
    expect(logged).not.toContain("ada@example.test");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("verify?token");
    expect(logged).not.toContain("Sign in link");
  });
});

describe("Effect.fn trace naming", () => {
  test("uses a unique Effect.fn trace name (not MagicLinkEmailDelivery.deliver)", async () => {
    const spanNames: string[] = [];
    const code = await runDeliver(
      resendEmailConfig,
      makeMagicLinkEmailDelivery(renderOk, productionEnvironment)
        .deliver(request)
        .pipe(Effect.withTracer(makeSpanNameCaptureTracer(spanNames)))
    );

    expect(code).toBe("account.magic-link.delivery-accepted");
    const [publicOperation] = spanNames;
    expect(publicOperation).toBeDefined();
    expect(publicOperation).not.toBe("MagicLinkEmailDelivery.deliver");
    expect(new Set(spanNames).size).toBe(spanNames.length);
  });
});

describe("Synthetic E2E email recipient pattern", () => {
  test("accepts run-id and label segments on the resend.dev test address", () => {
    expect(
      isSyntheticE2EEmailRecipient("delivered+run7f3a2b-signin@resend.dev")
    ).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient("delivered+abc123-delete@resend.dev")
    ).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient("delivered+a1b2-c3d4-e5f6-logout@resend.dev")
    ).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient("DELIVERED+run7f3a2b-signin@RESEND.DEV")
    ).toBe(true);
  });

  test("rejects malformed, bare, and arbitrary-domain addresses", () => {
    expect(isSyntheticE2EEmailRecipient("delivered@resend.dev")).toBe(false);
    expect(isSyntheticE2EEmailRecipient("delivered+onlylabel@resend.dev")).toBe(
      false
    );
    expect(isSyntheticE2EEmailRecipient("delivered+run-id-@resend.dev")).toBe(
      false
    );
    expect(
      isSyntheticE2EEmailRecipient("delivered+run--id-signin@resend.dev")
    ).toBe(false);
    expect(
      isSyntheticE2EEmailRecipient("delivered+run id-signin@resend.dev")
    ).toBe(false);
    expect(
      isSyntheticE2EEmailRecipient(
        "delivered+run7f3a2b-signin@resend.dev.evil.test"
      )
    ).toBe(false);
    expect(
      isSyntheticE2EEmailRecipient("delivered+run7f3a2b-signin@evil.test")
    ).toBe(false);
    expect(isSyntheticE2EEmailRecipient("ada@example.test")).toBe(false);
    expect(isSyntheticE2EEmailRecipient("")).toBe(false);
  });

  test("exports the exact anchored pattern behind the predicate", () => {
    expect("delivered+run7f3a2b-signin@resend.dev").toMatch(
      magicLinkSyntheticRecipientPattern
    );
    expect("delivered+run7f3a2b-signin@resend.dev.evil.test").not.toMatch(
      magicLinkSyntheticRecipientPattern
    );
  });
});
