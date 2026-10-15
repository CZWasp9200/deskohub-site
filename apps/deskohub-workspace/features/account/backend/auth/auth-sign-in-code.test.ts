import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Effect } from "effect";
import {
  BotDetectedError,
  type VerifyHumanInput,
} from "@/shared/backend/bot-protection/bot-protection.service";
import {
  type CapturedMagicLink,
  callHandler,
  cookieJar,
  getSessionCookie,
  makeMemoryTestAuth,
  makeTestAuth,
  type TestAuth,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";
import { digestVerificationKey } from "./auth-options";

/** Every field these tests send, including the ones the guard rejects. */
type AuthRequestBody = {
  readonly email?: string;
  readonly otp?: string;
  readonly type?: string;
  readonly callbackURL?: string;
  readonly metadata?: {
    readonly locale?: string;
    readonly signInCode?: boolean;
  };
  readonly name?: string;
  readonly image?: string;
  readonly locale?: string;
  readonly deletionRequestedAt?: string;
  readonly emailVerified?: boolean;
};

const postJson = (
  auth: TestAuth,
  path: string,
  body: AuthRequestBody,
  headers: Readonly<Record<string, string>> = {}
) =>
  callHandler(auth, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": uniqueIp(),
      ...headers,
    },
    body: JSON.stringify(body),
  });

const sendSignInEmail = (
  auth: TestAuth,
  email: string,
  body: AuthRequestBody = {}
) =>
  postJson(auth, "/sign-in/magic-link", {
    email,
    callbackURL: "/en-US/auth/callback",
    ...body,
  });

const signInWithCode = (
  auth: TestAuth,
  email: string,
  otp: string,
  callbackURL = "/en-US/auth/callback"
) => postJson(auth, "/sign-in/email-otp", { email, otp, callbackURL });

const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

const errorCode = async (response: Response) =>
  ((await response.json()) as { readonly code?: string }).code;

const verificationIdentifierCount = async (identifier: string) =>
  (
    await testDatabase!.pool.query(
      `select id from auth.verification where identifier = $1`,
      [await digestVerificationKey(identifier)]
    )
  ).rows.length;

describe("sign-in code gate", () => {
  test("keeps the link-only email with the flag off and says so", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    let botChecks = 0;
    const { auth, store } = makeMemoryTestAuth({
      sentLinks,
      verifyHuman: () =>
        Effect.sync(() => {
          botChecks += 1;
        }),
    });

    const response = await sendSignInEmail(auth, uniqueEmail("code-off"), {
      metadata: { locale: "en-US", signInCode: true },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true, signInCode: false });
    expect(sentLinks).toHaveLength(1);
    expect(sentLinks[0]!.code).toBeUndefined();
    expect(store.verification).toHaveLength(1);
    expect(botChecks).toBe(0);
  });

  test("fails closed to link-only when the flag cannot be read", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    const { auth } = makeMemoryTestAuth({
      sentLinks,
      isSignInCodeEnabled: () => Promise.reject(new Error("unreadable")),
    });

    const response = await sendSignInEmail(auth, uniqueEmail("code-flag-down"));

    expect(await response.json()).toEqual({ status: true, signInCode: false });
    expect(sentLinks[0]!.code).toBeUndefined();
  });

  test("sends a six-digit code with the link and says so when the flag is on", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    const { auth } = makeMemoryTestAuth({
      sentLinks,
      isSignInCodeEnabled: async () => true,
    });

    const response = await sendSignInEmail(auth, uniqueEmail("code-on"), {
      metadata: { locale: "cs-CZ", signInCode: false },
    });

    expect(await response.json()).toEqual({ status: true, signInCode: true });
    expect(sentLinks[0]!.code).toMatch(/^\d{6}$/);
    expect(sentLinks[0]!.url).toContain("/magic-link/verify");
  });

  test("returns 404 for every email-OTP endpoint except code sign-in", async () => {
    const { auth } = makeMemoryTestAuth();
    const email = uniqueEmail("disabled-otp");

    for (const path of [
      "/email-otp/send-verification-otp",
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ]) {
      const response = await postJson(auth, path, {
        email,
        otp: "123456",
        type: "sign-in",
      });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
  });

  test("rejects code sign-in fields beyond the email, code, and callback URL", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    const { auth, store } = makeMemoryTestAuth({
      sentLinks,
      isSignInCodeEnabled: async () => true,
    });
    const email = uniqueEmail("code-fields");
    await sendSignInEmail(auth, email);
    const code = sentLinks[0]!.code!;

    for (const extra of [
      { name: "Injected" },
      { image: "https://example.invalid/a.png" },
      { locale: "cs-CZ" },
      { deletionRequestedAt: new Date().toISOString() },
      { emailVerified: false },
    ]) {
      const response = await postJson(auth, "/sign-in/email-otp", {
        email,
        otp: code,
        ...extra,
      });
      expect(response.status).toBe(400);
    }
    expect(store.user).toHaveLength(0);

    const accepted = await signInWithCode(auth, email, code);
    expect(accepted.status).toBe(200);
    expect(store.user).toHaveLength(1);
    expect(store.user[0]!.name).toBe("");
  });

  test("closes code sign-in while accounts are disabled", async () => {
    const { auth } = makeMemoryTestAuth({
      areAccountsEnabled: async () => false,
    });

    const response = await signInWithCode(
      auth,
      uniqueEmail("code-accounts-off"),
      "123456"
    );

    expect(response.status).toBe(503);
  });

  test("BotID-checks code sign-in always and sign-in emails only while codes are on", async () => {
    const checks: VerifyHumanInput[] = [];
    const bot = (input: VerifyHumanInput) =>
      Effect.suspend(() => {
        checks.push(input);
        return Effect.fail(
          new BotDetectedError({ message: "Automated request detected" })
        );
      });
    const sentLinks: CapturedMagicLink[] = [];
    const off = makeMemoryTestAuth({ sentLinks, verifyHuman: bot });
    const on = makeTestAuth({
      database: memoryAdapter(off.store),
      sentLinks,
      verifyHuman: bot,
      isSignInCodeEnabled: async () => true,
    });
    const email = uniqueEmail("code-bot");

    const linkOnly = await sendSignInEmail(off.auth, email);
    expect(linkOnly.status).toBe(200);
    expect(checks).toHaveLength(0);

    const blockedSend = await sendSignInEmail(on, email);
    expect(blockedSend.status).toBe(403);
    expect(await errorCode(blockedSend)).toBe("BOT_DETECTED");
    expect(sentLinks).toHaveLength(1);

    const blockedSignIn = await signInWithCode(off.auth, email, "123456");
    expect(blockedSignIn.status).toBe(403);
    expect(await errorCode(blockedSignIn)).toBe("BOT_DETECTED");

    expect(checks).toEqual([
      { verificationFailurePolicy: "allow" },
      { verificationFailurePolicy: "allow" },
    ]);
  });
});

describe.skipIf(!testDatabase)(
  "sign-in codes on the migrated disposable Postgres",
  () => {
    const makeCodeAuth = (sentLinks: CapturedMagicLink[]) =>
      makeTestAuth({ sentLinks, isSignInCodeEnabled: async () => true });

    test("creates a new account through the code with the callback locale", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-signup");

      await sendSignInEmail(auth, email, {
        callbackURL: "/cs-CZ/auth/callback",
      });
      const response = await signInWithCode(
        auth,
        email,
        sentLinks[0]!.code!,
        "/cs-CZ/auth/callback"
      );

      expect(response.status).toBe(200);
      expect(getSessionCookie(response)).toBeDefined();
      const user = await testDatabase!.pool.query<{
        locale: string | null;
        email_verified: boolean;
        name: string;
      }>(
        `select locale, email_verified, name from auth."user" where email = $1`,
        [email.toLowerCase()]
      );
      expect(user.rows).toEqual([
        { locale: "cs-CZ", email_verified: true, name: "" },
      ]);
    });

    test("using the code removes the link sent with it", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-ends-link");

      await sendSignInEmail(auth, email);
      const signedIn = await signInWithCode(auth, email, sentLinks[0]!.code!);
      expect(signedIn.status).toBe(200);

      const link = await verifyMagicLink(auth, sentLinks[0]!);
      expect(getSessionCookie(link)).toBeUndefined();
      expect(link.headers.get("location") ?? "").toContain(
        "error=INVALID_TOKEN"
      );
      expect(await verificationIdentifierCount(`sign-in-link-${email}`)).toBe(
        0
      );
    });

    test("using the link removes the code sent with it", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("link-ends-code");

      await sendSignInEmail(auth, email);
      const link = await verifyMagicLink(auth, sentLinks[0]!);
      expect(getSessionCookie(link)).toBeDefined();

      const code = await signInWithCode(auth, email, sentLinks[0]!.code!);
      expect(code.status).toBe(400);
      expect(await errorCode(code)).toBe("INVALID_OTP");
      expect(await verificationIdentifierCount(`sign-in-otp-${email}`)).toBe(0);
    });

    test("a new email replaces the older code without duplicate rows and keeps older links", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-resend");

      await sendSignInEmail(auth, email);
      await sendSignInEmail(auth, email);
      const [first, second] = sentLinks;

      expect(await verificationIdentifierCount(`sign-in-otp-${email}`)).toBe(1);
      expect(await verificationIdentifierCount(`sign-in-link-${email}`)).toBe(
        1
      );

      if (first!.code !== second!.code) {
        const stale = await signInWithCode(auth, email, first!.code!);
        expect(await errorCode(stale)).toBe("INVALID_OTP");
      }
      const fresh = await signInWithCode(auth, email, second!.code!);
      expect(fresh.status).toBe(200);

      // The older link keeps today's behaviour: it still signs in once.
      const olderLink = await verifyMagicLink(auth, first!);
      expect(getSessionCookie(olderLink)).toBeDefined();
    });

    test("burns the code after five wrong attempts", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-attempts");

      await sendSignInEmail(auth, email);
      const code = sentLinks[0]!.code!;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await signInWithCode(auth, email, wrongCode(code));
        expect(await errorCode(wrong)).toBe("INVALID_OTP");
      }
      const exhausted = await signInWithCode(auth, email, code);
      expect(exhausted.status).toBe(403);
      expect(await errorCode(exhausted)).toBe("TOO_MANY_ATTEMPTS");

      const burned = await signInWithCode(auth, email, code);
      expect(await errorCode(burned)).toBe("INVALID_OTP");
      expect(await userIdForEmail(email.toLowerCase())).toBeUndefined();
    });

    test("caps sign-in emails per address per rolling hour while codes are on", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-cap");

      for (let send = 0; send < 5; send += 1) {
        const accepted = await sendSignInEmail(auth, email);
        expect(accepted.status).toBe(200);
      }
      const capped = await sendSignInEmail(auth, email.toUpperCase());
      expect(capped.status).toBe(429);
      expect(await errorCode(capped)).toBe("SIGN_IN_EMAIL_LIMIT_REACHED");
      expect(sentLinks).toHaveLength(5);

      // Rejected sends don't extend the window; aged-out sends free it.
      await testDatabase!.pool.query(
        `update auth.verification set expires_at = now() - interval '1 second'
         where identifier = $1`,
        [`sign-in-email-${await digestVerificationKey(email.toLowerCase())}`]
      );
      expect((await sendSignInEmail(auth, email)).status).toBe(200);

      const linkOnly = makeTestAuth({ sentLinks });
      for (let send = 0; send < 6; send += 1) {
        expect((await sendSignInEmail(linkOnly, email)).status).toBe(200);
      }
    });

    test("a code sign-in satisfies the fresh session that deletion requires", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      let deletions = 0;
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
        beforeDeleteUser: () =>
          Effect.sync(() => {
            deletions += 1;
          }),
      });
      const email = uniqueEmail("code-reauth");

      await sendSignInEmail(auth, email);
      const first = await signInWithCode(auth, email, sentLinks[0]!.code!);
      const staleCookie = cookieJar(getSessionCookie(first)!);
      const userId = (await userIdForEmail(email.toLowerCase()))!;
      await testDatabase!.pool.query(
        `update auth.session set created_at = now() - interval '20 minutes' where user_id = $1`,
        [userId]
      );

      const stale = await postJson(
        auth,
        "/delete-user",
        {},
        { cookie: staleCookie }
      );
      expect(stale.status).toBe(400);

      await sendSignInEmail(auth, email);
      const reauthenticated = await signInWithCode(
        auth,
        email,
        sentLinks[1]!.code!
      );
      const freshCookie = cookieJar(getSessionCookie(reauthenticated)!);
      const deleted = await postJson(
        auth,
        "/delete-user",
        {},
        { cookie: freshCookie }
      );

      expect(deleted.status).toBe(200);
      expect(deletions).toBe(1);
      expect(await userIdForEmail(email.toLowerCase())).toBeUndefined();
    });
  }
);
