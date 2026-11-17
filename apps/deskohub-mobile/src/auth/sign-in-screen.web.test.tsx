import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { parseJSON } from "better-auth/client";
import { Effect } from "effect";
import { act, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { AppLocaleProvider } from "../i18n/locale-context";
import { clientRoot } from "../testing/client-root";
import { eventually } from "../testing/eventually";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";
import { Button, Screen, TextField } from "../ui/controls";
import { find, findAll } from "../ui/testing/element-tree";
import { AppSignInCodeStep } from "./app-sign-in-code-step.web";
import { AppSignInContinueStep } from "./app-sign-in-continue-step";
import { appSignInEmailHeading } from "./app-sign-in-email-heading";
import { AppSignInEmailStep } from "./app-sign-in-email-step";
import { AppSignInLinkStep } from "./app-sign-in-link-step";
import { nativeReturnUri } from "./auth-callback";
import type { AuthSessionState } from "./auth-session-state";
import { ReauthenticationShield } from "./reauthentication-shield";
import {
  clearNativeHandoffRequest,
  saveNativeHandoffRequest,
} from "./web-native-request-store";

let session: AuthSessionState = { status: "signed-out" };
mock.module("./use-auth-session", () => ({
  useAuthSession: () => session,
}));

const inert = () => null;
mock.module("expo-router", () => ({
  ...expoRouterStandIn(),
  Redirect: inert,
  router: {
    canGoBack: () => false,
    back: inert,
    replace: inert,
  },
}));

/** A Better Auth client answer, as the page's auth client resolves it. */
type Answer = {
  readonly data: unknown;
  readonly error: Readonly<Record<string, unknown>> | null;
};
const ok = (data: unknown): Answer => ({ data, error: null });
const refused = (error: Readonly<Record<string, unknown>>): Answer => ({
  data: null,
  error,
});

/** What the fake server answers next, per request. */
let emailAnswers: Array<Answer> = [];
let codeAnswers: Array<Answer> = [];
let emailsSent = 0;
let emailedTo: Array<string> = [];
const next = (answers: Array<Answer>) => {
  const answer = answers.shift();
  if (!answer) throw new Error("The test gave the server no answer.");
  return answer;
};

mock.module("./auth-client.web", () => ({
  authClient: {
    $fetch: async () => refused({ status: 500 }),
    getSession: async () => ok(null),
    signIn: {
      magicLink: async ({ email }: { readonly email: string }) => {
        emailsSent += 1;
        emailedTo.push(email);
        // Better Auth's client parses answers with its own JSON parser,
        // which revives ISO 8601 strings into Dates.
        return parseJSON<Answer>(JSON.stringify(next(emailAnswers)));
      },
      emailOtp: async () => next(codeAnswers),
    },
    magicLink: { verify: async () => refused({ status: 400 }) },
    signOut: async () => ok({ success: true }),
  },
}));

const { SignInScreen } = await import("./sign-in-screen.web");

const codesOn = (nextSignInEmailAt?: number) =>
  ok({
    status: true,
    signInCode: true,
    ...(nextSignInEmailAt !== undefined && {
      nextSignInEmailAt: new Date(nextSignInEmailAt).toISOString(),
    }),
  });

const appRequest = {
  codeChallenge: "c".repeat(43),
  state: "s".repeat(43),
  returnUri: nativeReturnUri,
  reauthenticate: false,
} as const;

const openedByApp = () => saveNativeHandoffRequest(appRequest, Date.now());

/** The app asks to confirm its account before deleting it. */
const appReauthentication = {
  ...appRequest,
  reauthenticate: true,
  loginHint: testEmailAddress("app-account"),
  purpose: "delete-account",
} as const;

/** The tree the page returns on its latest render. */
let shown: ReactNode = null;
const passkeyOption = mock(() => <View testID="passkey" />);
function Page() {
  shown = SignInScreen({ passkeyOption });
  return null;
}

/** The props of the step the page shows, which must be `component`. */
const shownStep = <Props,>(component: (props: Props) => ReactNode): Props => {
  const element = shown as ReactElement<Props>;
  expect(element.type).toBe(component as never);
  return element.props;
};

const settle = (check: () => boolean) =>
  Effect.runPromise(
    eventually(check, () => String((shown as ReactElement)?.type))
  );

const runInPage = (run: () => void) => act(async () => run());

describe("the web SignInScreen", () => {
  const { render } = clientRoot();
  const show = () =>
    render(
      <AppLocaleProvider locale="en-US">
        <Page />
      </AppLocaleProvider>
    );

  beforeEach(() => {
    session = { status: "signed-out" };
    emailAnswers = [];
    codeAnswers = [];
    emailsSent = 0;
    emailedTo = [];
    passkeyOption.mockClear();
    clearNativeHandoffRequest();
  });
  afterEach(async () => {
    await render(null);
    clearNativeHandoffRequest();
  });

  test("without the app's request it keeps its own page, passkey option included", async () => {
    await show();
    const screen = shown as ReactElement;
    expect(screen.type).toBe(Screen);
    expect(find(screen, TextField)).toBeDefined();
    expect(findAll(screen, Button).length).toBeGreaterThan(0);
    expect(passkeyOption).toHaveBeenCalled();
    expect(find(screen, AppSignInEmailStep)).toBeUndefined();
  });

  test("opened by the app, it shows the app's email step without a passkey option", async () => {
    openedByApp();
    await show();
    shownStep(AppSignInEmailStep);
    expect(passkeyOption).not.toHaveBeenCalled();
  });

  test("the app's reauthentication confirms its account: shield, locked address, no passkey", async () => {
    saveNativeHandoffRequest(appReauthentication, Date.now());
    // The browser may hold someone else's session; the app's account wins.
    session = {
      status: "signed-in",
      user: { id: "other", email: testEmailAddress("browser") },
      signedInAt: new Date(Date.now() - 60 * 60_000),
    };
    await show();
    const step = shownStep(AppSignInEmailStep);
    const heading = appSignInEmailHeading(appReauthentication, "en-US");
    expect(step.title).toBe(heading.title);
    expect(step.body).toBe(heading.body);
    expect((step.illustration as ReactElement).type).toBe(
      ReauthenticationShield
    );
    expect(step.email).toMatchObject({
      value: appReauthentication.loginHint,
      locked: true,
    });
    expect(passkeyOption).not.toHaveBeenCalled();

    // Typing can't move the code to another address.
    await runInPage(() =>
      shownStep(AppSignInEmailStep).email.onChange(testEmailAddress("else"))
    );
    expect(shownStep(AppSignInEmailStep).email.value).toBe(
      appReauthentication.loginHint
    );
    emailAnswers.push(codesOn());
    await runInPage(() => shownStep(AppSignInEmailStep).onSubmit());
    await settle(() => (shown as ReactElement).type === AppSignInCodeStep);
    expect(emailedTo).toEqual([appReauthentication.loginHint]);

    // Starting over keeps the address locked.
    await runInPage(() => shownStep(AppSignInCodeStep).onUseDifferentEmail());
    expect(shownStep(AppSignInEmailStep).email).toMatchObject({
      value: appReauthentication.loginHint,
      locked: true,
    });
  });

  test("an ordinary sign-in from the app shows no shield", async () => {
    openedByApp();
    await show();
    expect(shownStep(AppSignInEmailStep).illustration).toBeUndefined();
    expect(shownStep(AppSignInEmailStep).email.locked).toBe(false);
  });

  test("an invalid address shows at the field and sends nothing", async () => {
    openedByApp();
    await show();
    await runInPage(() => shownStep(AppSignInEmailStep).email.onChange("x"));
    await runInPage(() => shownStep(AppSignInEmailStep).onSubmit());
    expect(shownStep(AppSignInEmailStep).error).toBeDefined();
    expect(emailsSent).toBe(0);
    // Typing again clears the error.
    await runInPage(() => shownStep(AppSignInEmailStep).email.onChange("xy"));
    expect(shownStep(AppSignInEmailStep).error).toBeUndefined();
  });

  const toCode = async (answer: Answer = codesOn()) => {
    openedByApp();
    await show();
    emailAnswers.push(answer);
    await runInPage(() =>
      shownStep(AppSignInEmailStep).email.onChange(testEmailAddress("app"))
    );
    await runInPage(() => shownStep(AppSignInEmailStep).onSubmit());
    await settle(() => (shown as ReactElement).type === AppSignInCodeStep);
    return shownStep(AppSignInCodeStep);
  };

  test("after the email, the code step waits out the resend cooldown", async () => {
    const before = Date.now();
    const step = await toCode();
    expect(step.email).toBe(testEmailAddress("app"));
    expect(step.resendAvailableAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(step.invalid).toBe(false);
    expect(step.exhausted).toBe(false);
  });

  test("the server's later instant gates the resend", async () => {
    const serverAt = Date.now() + 5 * 60_000;
    const step = await toCode(codesOn(serverAt));
    expect(step.resendAvailableAt).toBe(serverAt);
  });

  test("a wrong code rings the boxes and offers a resend at once; the resend clears the code and confirms", async () => {
    await toCode();
    codeAnswers.push(refused({ status: 400, code: "INVALID_OTP" }));
    await runInPage(() => shownStep(AppSignInCodeStep).onCodeChange("000000"));
    await runInPage(() => shownStep(AppSignInCodeStep).onSubmit("000000"));
    await settle(() => shownStep(AppSignInCodeStep).invalid);
    const wrong = shownStep(AppSignInCodeStep);
    expect(wrong.notice?.tone).toBe("error");
    // The rejected code leaves the boxes empty for the next one.
    expect(wrong.code).toBe("");
    expect(wrong.resendAvailableAt).toBeLessThanOrEqual(Date.now());

    const before = Date.now();
    emailAnswers.push(codesOn());
    await runInPage(() => shownStep(AppSignInCodeStep).onResend());
    await settle(
      () => shownStep(AppSignInCodeStep).notice?.tone === "positive"
    );
    const resent = shownStep(AppSignInCodeStep);
    expect(resent.code).toBe("");
    expect(resent.invalid).toBe(false);
    expect(resent.resendAvailableAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(emailsSent).toBe(2);
  });

  test("too many wrong codes lock the boxes; a refused new code waits for the server's instant", async () => {
    await toCode();
    codeAnswers.push(refused({ status: 403, code: "TOO_MANY_ATTEMPTS" }));
    await runInPage(() => shownStep(AppSignInCodeStep).onSubmit("000000"));
    await settle(() => shownStep(AppSignInCodeStep).exhausted);
    // The dead code leaves the boxes empty.
    expect(shownStep(AppSignInCodeStep).code).toBe("");

    const serverAt = Date.now() + 10 * 60_000;
    emailAnswers.push(
      refused({
        status: 429,
        code: "SIGN_IN_EMAIL_LIMIT_REACHED",
        nextSignInEmailAt: new Date(serverAt).toISOString(),
      })
    );
    await runInPage(() => shownStep(AppSignInCodeStep).onResend());
    await settle(
      () => shownStep(AppSignInCodeStep).resendAvailableAt === serverAt
    );
    const limited = shownStep(AppSignInCodeStep);
    expect(limited.exhausted).toBe(true);
    expect(limited.notice?.tone).toBe("error");
    expect(limited.resendAvailableAt).toBe(serverAt);
  });

  test("the server's latest instant keeps gating the resend through later tries", async () => {
    await toCode();
    codeAnswers.push(refused({ status: 400, code: "INVALID_OTP" }));
    await runInPage(() => shownStep(AppSignInCodeStep).onSubmit("000000"));
    await settle(() => shownStep(AppSignInCodeStep).invalid);

    const serverAt = Date.now() + 10 * 60_000;
    emailAnswers.push(
      refused({
        status: 429,
        code: "SIGN_IN_EMAIL_LIMIT_REACHED",
        nextSignInEmailAt: new Date(serverAt).toISOString(),
      })
    );
    await runInPage(() => shownStep(AppSignInCodeStep).onResend());
    await settle(
      () => shownStep(AppSignInCodeStep).resendAvailableAt === serverAt
    );

    // Another wrong code clears the refusal's message, not its instant.
    codeAnswers.push(refused({ status: 400, code: "INVALID_OTP" }));
    await runInPage(() => shownStep(AppSignInCodeStep).onSubmit("111111"));
    await settle(
      () =>
        shownStep(AppSignInCodeStep).invalid &&
        codeAnswers.length === 0 &&
        !shownStep(AppSignInCodeStep).checking
    );
    expect(shownStep(AppSignInCodeStep).resendAvailableAt).toBe(serverAt);
  });

  test("an email with only a link shows the link step", async () => {
    openedByApp();
    await show();
    emailAnswers.push(ok({ status: true, signInCode: false }));
    await runInPage(() =>
      shownStep(AppSignInEmailStep).email.onChange(testEmailAddress("link"))
    );
    await runInPage(() => shownStep(AppSignInEmailStep).onSubmit());
    await settle(() => (shown as ReactElement).type === AppSignInLinkStep);
    expect(shownStep(AppSignInLinkStep).email).toBe(testEmailAddress("link"));
  });

  test("a fresh browser session continues as its account", async () => {
    openedByApp();
    session = {
      status: "signed-in",
      user: { id: "user", email: testEmailAddress("signed-in") },
      signedInAt: new Date(),
    };
    await show();
    expect(shownStep(AppSignInContinueStep).email).toBe(
      testEmailAddress("signed-in")
    );
  });
});
