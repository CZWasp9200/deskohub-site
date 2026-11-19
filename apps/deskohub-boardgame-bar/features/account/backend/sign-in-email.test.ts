import { describe, expect, it } from "bun:test";
import { callbackLocale, signInEmailLocale } from "./sign-in-email";

describe("sign-in language", () => {
  it("reads the language from a bare callback path", () => {
    expect(callbackLocale("/en-US/account")).toBe("en-US");
    expect(callbackLocale("/cs-CZ/membership")).toBe("cs-CZ");
  });

  it("reads the language from an absolute callback", () => {
    expect(callbackLocale("https://bar.deskohub.cz/en-US/events")).toBe(
      "en-US"
    );
  });

  it("falls back to the bar's language without a known one", () => {
    expect(callbackLocale("")).toBe("cs-CZ");
    expect(callbackLocale("/de-DE/account")).toBe("cs-CZ");
  });

  it("reads the callback out of a sign-in link", () => {
    const link =
      "https://bar.deskohub.cz/api/auth/magic-link/verify?token=x&callbackURL=%2Fen-US%2Faccount";
    expect(signInEmailLocale(link)).toBe("en-US");
  });
});
