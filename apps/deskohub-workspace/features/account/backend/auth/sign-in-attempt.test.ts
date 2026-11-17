import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  type CapturedMagicLink,
  callHandler,
  callNativeHandler,
  cookieJar,
  getSessionCookie,
  HOST,
  makeMemoryTestAuth,
  type TestAuth,
  uniqueEmail,
  uniqueIp,
  verifyMagicLink,
} from "./auth-handler.test-utils";

/**
 * Sign-in attempts. A sign-in email the `/app/` page sends for the app
 * callback answers with an attempt, and the page asks whether that attempt
 * signed in somewhere else: only a link verification that creates a session
 * completes it.
 */

const appCallback = "/app/auth/callback";

type SignInEmailBody = {
  readonly email?: string;
  readonly callbackURL?: string;
  readonly newUserCallbackURL?: string;
  readonly errorCallbackURL?: string;
  readonly metadata?: { readonly signInAttempt: string };
};

type CodeSignInBody = {
  readonly email: string;
  readonly otp: string | undefined;
  readonly callbackURL: string;
};

/** Status bodies, including entries of the wrong kind the endpoint refuses. */
type StatusBody = { readonly attempts: ReadonlyArray<string | number> };

const postJson = (
  auth: TestAuth,
  path: string,
  body: SignInEmailBody | CodeSignInBody | StatusBody,
  ip = uniqueIp()
) =>
  callHandler(auth, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });

/** The sign-in email answer's attempt, when it names one. */
const sendAnswer = Schema.Struct({
  signInAttempt: Schema.optional(Schema.String),
});

/** The answer to an email sent for the app callback, which names one. */
const appSendAnswer = Schema.Struct({ signInAttempt: Schema.String });

const attemptsFor = ({ signInCodes = false } = {}) => {
  const sentLinks: CapturedMagicLink[] = [];
  const { auth } = makeMemoryTestAuth({
    sentLinks,
    signInCodeFlag: Effect.succeed(signInCodes),
  });

  const send = async (body: SignInEmailBody) => {
    const response = await postJson(auth, "/sign-in/magic-link", {
      email: uniqueEmail("sign-in-attempt"),
      ...body,
    });
    expect(response.status).toBe(200);
    const json: unknown = await response.json();
    return {
      json,
      answer: Schema.decodeUnknownSync(sendAnswer)(json),
      link: sentLinks.at(-1)!,
    };
  };

  const sendForApp = async (email = uniqueEmail("sign-in-attempt")) => {
    const { json, link } = await send({ email, callbackURL: appCallback });
    const { signInAttempt } = Schema.decodeUnknownSync(appSendAnswer)(json);
    return { attempt: signInAttempt, link };
  };

  const verifyInApp = (link: CapturedMagicLink, cookie?: string) =>
    callNativeHandler(
      auth,
      `/magic-link/verify?token=${encodeURIComponent(link.token)}`,
      cookie ? { headers: { cookie } } : {}
    );

  const status = async (attempts: StatusBody["attempts"], ip?: string) => {
    const response = await postJson(
      auth,
      "/sign-in-attempt/status",
      { attempts },
      ip
    );
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: response.status === 200 ? await response.json() : undefined,
    };
  };

  const completed = async (attempts: readonly string[]) =>
    ((await status(attempts)).body as { completed: boolean }).completed;

  return { auth, send, sendForApp, verifyInApp, status, completed };
};

afterEach(() => {
  setSystemTime();
});

describe("sign-in attempts", () => {
  test("are issued only for emails sent for the app callback", async () => {
    const { send } = attemptsFor();

    for (const body of [
      { callbackURL: "/cs-CZ/auth/callback" },
      { callbackURL: "/app/auth/callback?next=1" },
      { callbackURL: appCallback, errorCallbackURL: "/app/sign-in" },
      { callbackURL: appCallback, newUserCallbackURL: "/app/welcome" },
      {},
    ]) {
      const { answer } = await send(body);
      expect(answer.signInAttempt).toBeUndefined();
    }
  });

  test("replace an attempt the client names", async () => {
    const { send } = attemptsFor();
    const named = "n".repeat(43);

    const elsewhere = await send({
      callbackURL: "/cs-CZ/auth/callback",
      metadata: { signInAttempt: named },
    });
    expect(elsewhere.answer.signInAttempt).toBeUndefined();

    const forApp = await send({
      callbackURL: appCallback,
      metadata: { signInAttempt: named },
    });
    expect(forApp.answer.signInAttempt).toEqual(expect.any(String));
    expect(forApp.answer.signInAttempt).not.toBe(named);
  });

  test("are fresh and long enough for each email", async () => {
    const { sendForApp } = attemptsFor();
    const email = uniqueEmail("sign-in-attempt");

    const first = await sendForApp(email);
    const second = await sendForApp(email);

    expect(first.attempt.length).toBeGreaterThanOrEqual(32);
    expect(second.attempt).not.toBe(first.attempt);
  });

  test("come with the sign-in code decision", async () => {
    const { sendForApp } = attemptsFor({ signInCodes: true });

    const { link } = await sendForApp();

    expect(link.code).toEqual(expect.any(String));
  });

  test("complete when the app verifies the email's link", async () => {
    const { sendForApp, verifyInApp, completed } = attemptsFor();
    const { attempt, link } = await sendForApp();
    expect(await completed([attempt])).toBe(false);

    const verified = await verifyInApp(link);
    expect(verified.status).toBe(200);

    expect(await completed([attempt])).toBe(true);
  });

  test("complete when the link is verified with auth.api", async () => {
    const { auth, sendForApp, completed } = attemptsFor();
    const { attempt, link } = await sendForApp();

    await auth.api.magicLinkVerify({
      query: { token: link.token },
      headers: new Headers({ host: HOST }),
    });

    expect(await completed([attempt])).toBe(true);
  });

  test("complete through an older email's link after a resend", async () => {
    const { sendForApp, verifyInApp, completed } = attemptsFor();
    const email = uniqueEmail("sign-in-attempt");
    const first = await sendForApp(email);
    const second = await sendForApp(email);

    expect((await verifyInApp(first.link)).status).toBe(200);

    expect(await completed([second.attempt])).toBe(false);
    expect(await completed([first.attempt, second.attempt])).toBe(true);
  });

  test("stay open for another email's link", async () => {
    const { sendForApp, verifyInApp, completed } = attemptsFor();
    const waiting = await sendForApp();
    const other = await sendForApp();

    expect((await verifyInApp(other.link)).status).toBe(200);

    expect(await completed([waiting.attempt])).toBe(false);
  });

  test("stay open when the link signs in elsewhere without an attempt", async () => {
    const { auth, send, completed, sendForApp } = attemptsFor();
    const { attempt } = await sendForApp();
    const { link } = await send({ callbackURL: "/cs-CZ/auth/callback" });

    expect((await verifyMagicLink(auth, link)).status).toBe(302);

    expect(await completed([attempt])).toBe(false);
  });

  test("stay open when the email's code signs in on the page", async () => {
    const { auth, sendForApp, verifyInApp, completed } = attemptsFor({
      signInCodes: true,
    });
    const { attempt, link } = await sendForApp();

    const signedIn = await postJson(auth, "/sign-in/email-otp", {
      email: link.email,
      otp: link.code,
      callbackURL: appCallback,
    });
    expect(signedIn.status).toBe(200);
    // The code used the email, so its link no longer signs in.
    expect((await verifyInApp(link)).status).not.toBe(200);

    expect(await completed([attempt])).toBe(false);
  });

  test("stay open when the link has expired", async () => {
    const { sendForApp, verifyInApp, completed } = attemptsFor();
    const { attempt, link } = await sendForApp();
    setSystemTime(new Date(Date.now() + 10 * 60 * 1000 + 1000));

    expect((await verifyInApp(link)).status).toBe(400);

    expect(await completed([attempt])).toBe(false);
  });

  test("stay open when the app refuses to switch accounts", async () => {
    const { sendForApp, verifyInApp, completed } = attemptsFor();
    const signedIn = await verifyInApp((await sendForApp()).link);
    const cookie = cookieJar(getSessionCookie(signedIn)!);
    const { attempt, link } = await sendForApp();

    const refused = await verifyInApp(link, cookie);
    expect(refused.status).toBe(403);

    expect(await completed([attempt])).toBe(false);
  });

  test("answer completed until the link's lifetime ends", async () => {
    const { sendForApp, verifyInApp, completed } = attemptsFor();
    const { attempt, link } = await sendForApp();
    expect((await verifyInApp(link)).status).toBe(200);

    setSystemTime(new Date(Date.now() + 10 * 60 * 1000 + 1000));

    expect(await completed([attempt])).toBe(false);
  });
});

describe("the sign-in attempt status", () => {
  test("answers unknown attempts as open, without a session, and uncached", async () => {
    const { status } = attemptsFor();

    const answer = await status(["u".repeat(43)]);

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ completed: false });
    expect(answer.cacheControl).toBe("no-store");
  });

  test("takes one to five bounded attempts", async () => {
    const { status } = attemptsFor();
    const attempt = "a".repeat(43);

    for (const attempts of [
      [],
      Array(6).fill(attempt),
      [""],
      ["a".repeat(129)],
      [42],
    ]) {
      expect((await status(attempts)).status).toBe(400);
    }
    expect((await status(Array(5).fill(attempt))).status).toBe(200);
    expect((await status(["a".repeat(128)])).status).toBe(200);
  });

  test("limits statuses per client IP", async () => {
    const { status } = attemptsFor();
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let asked = 0; asked < 31; asked += 1) {
      statuses.push((await status(["a".repeat(43)], ip)).status);
    }

    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(200));
    expect(statuses[30]).toBe(429);
  });
});
