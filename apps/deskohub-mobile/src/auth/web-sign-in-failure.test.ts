import { expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import {
  decodeNextSignInEmailAt,
  WebSignInFailure,
  webSignInFailureReason,
} from "./web-sign-in-failure";

test("maps each operation's Better Auth errors to a reason", () => {
  const cases: ReadonlyArray<
    readonly [
      Parameters<typeof webSignInFailureReason>[0],
      { readonly status?: number; readonly code?: string },
      ReturnType<typeof webSignInFailureReason>,
    ]
  > = [
    ["send-email", { status: 403, code: "BOT_DETECTED" }, "automated"],
    [
      "send-email",
      { status: 429, code: "SIGN_IN_EMAIL_LIMIT_REACHED" },
      "address-limit",
    ],
    ["send-email", { status: 429 }, "rate-limited"],
    ["send-email", { status: 400, code: "INVALID_EMAIL" }, "failed"],
    ["verify-code", { status: 403, code: "BOT_DETECTED" }, "automated"],
    ["verify-code", { status: 400, code: "INVALID_OTP" }, "wrong-code"],
    ["verify-code", { status: 400, code: "OTP_EXPIRED" }, "expired-code"],
    [
      "verify-code",
      { status: 403, code: "TOO_MANY_ATTEMPTS" },
      "too-many-attempts",
    ],
    ["verify-code", { status: 429 }, "rate-limited"],
    ["verify-link", { status: 400, code: "INVALID_TOKEN" }, "link-rejected"],
    ["verify-link", { status: 500 }, "failed"],
    [
      "verify-link",
      { status: 403, code: "ACCOUNT_SWITCH_REFUSED" },
      "account-switch",
    ],
    ["verify-link", { status: 403 }, "failed"],
    [
      "mint-handoff",
      { status: 403, code: "SESSION_NOT_FRESH" },
      "session-not-fresh",
    ],
    ["mint-handoff", { status: 401, code: "UNAUTHORIZED" }, "signed-out"],
    ["mint-handoff", { status: 429 }, "rate-limited"],
    ["mint-handoff", { status: 400, code: "INVALID_RETURN_URI" }, "failed"],
  ];
  for (const [operation, error, reason] of cases) {
    expect([
      operation,
      error,
      webSignInFailureReason(operation, error),
    ]).toEqual([operation, error, reason]);
  }
});

test("only an address-limit failure keeps the server's next send", () => {
  const nextSignInEmailAt = "2026-11-15T20:41:07.123Z";
  const limited = WebSignInFailure.fromAnswer("send-email")({
    status: 429,
    code: "SIGN_IN_EMAIL_LIMIT_REACHED",
    nextSignInEmailAt,
  });
  expect(
    limited.nextSignInEmailAt === undefined
      ? undefined
      : DateTime.toEpochMillis(limited.nextSignInEmailAt)
  ).toBe(Date.parse(nextSignInEmailAt));
  for (const [operation, answer] of [
    ["send-email", { status: 429, nextSignInEmailAt }],
    ["verify-code", { status: 429, nextSignInEmailAt }],
    ["send-email", { status: 429, code: "SIGN_IN_EMAIL_LIMIT_REACHED" }],
  ] as const) {
    expect(
      Object.hasOwn(
        WebSignInFailure.fromAnswer(operation)(answer),
        "nextSignInEmailAt"
      )
    ).toBe(false);
  }
});

test("reads the server's next send whether it arrives as the wire string or a revived Date", () => {
  const at = "2026-11-15T20:41:07.123Z";
  for (const answer of [at, new Date(at)]) {
    expect(
      Option.map(decodeNextSignInEmailAt(answer), DateTime.toEpochMillis)
    ).toEqual(Option.some(Date.parse(at)));
  }
  for (const answer of [
    new Date("not a date"),
    "2026-13-45T99:00:00Z",
    "soon",
    60,
    null,
    undefined,
  ]) {
    expect(decodeNextSignInEmailAt(answer)).toEqual(Option.none());
  }
  // Better Auth's client revives the 429 body's instant too.
  const limited = WebSignInFailure.fromAnswer("send-email")({
    status: 429,
    code: "SIGN_IN_EMAIL_LIMIT_REACHED",
    nextSignInEmailAt: new Date(at),
  });
  expect(
    limited.nextSignInEmailAt &&
      DateTime.toEpochMillis(limited.nextSignInEmailAt)
  ).toBe(Date.parse(at));
});
