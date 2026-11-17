import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Option } from "effect";
import { signInStep } from "./sign-in-step";

describe("signInStep", () => {
  const email = testEmailAddress("ada");

  test("asks for the email until one is sent", () => {
    expect(signInStep(undefined, undefined)).toBe("email");
  });

  test("asks for the code when the email carries one", () => {
    expect(
      signInStep(undefined, {
        email,
        signInCode: true,
        sentAt: 0,
        nextSignInEmailAt: Option.none(),
        signInAttempt: Option.none(),
      })
    ).toBe("code");
  });

  test("points to the link alone when the email carries no code", () => {
    expect(
      signInStep(undefined, {
        email,
        signInCode: false,
        sentAt: 0,
        nextSignInEmailAt: Option.none(),
        signInAttempt: Option.none(),
      })
    ).toBe("link");
  });

  test("offers to continue a fresh session first", () => {
    expect(signInStep(email, undefined)).toBe("continue");
    expect(
      signInStep(email, {
        email,
        signInCode: false,
        sentAt: 0,
        nextSignInEmailAt: Option.none(),
        signInAttempt: Option.none(),
      })
    ).toBe("continue");
  });
});
