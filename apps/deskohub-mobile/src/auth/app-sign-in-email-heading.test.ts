import { describe, expect, test } from "bun:test";
import { appLocales } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import { appSignInEmailHeading } from "./app-sign-in-email-heading";
import { nativeReturnUri } from "./auth-callback";

const request = {
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  returnUri: nativeReturnUri,
  reauthenticate: false,
} as const;

describe("appSignInEmailHeading", () => {
  test("keeps the ordinary sign-in heading when the app isn't reauthenticating", () => {
    expect(appSignInEmailHeading(request, "en-US")).toEqual({
      title: m.signin_create_title({}, { locale: "en-US" }),
      confirmsAccount: false,
    });
  });

  test("asks to confirm the account and names the deletion it is for", () => {
    for (const locale of appLocales) {
      expect(
        appSignInEmailHeading(
          { ...request, reauthenticate: true, purpose: "delete-account" },
          locale
        )
      ).toEqual({
        title: m.signin_reauthenticate_title({}, { locale }),
        body: m.signin_reauthenticate_delete_account_body({}, { locale }),
        confirmsAccount: true,
      });
    }
  });

  test("adds no body when the app names no purpose", () => {
    expect(
      appSignInEmailHeading({ ...request, reauthenticate: true }, "cs-CZ")
    ).toEqual({
      title: m.signin_reauthenticate_title({}, { locale: "cs-CZ" }),
      confirmsAccount: true,
    });
  });
});
