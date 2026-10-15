import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { renderMagicLinkEmail } from "./magic-link-email";

const customerEmail = testEmailAddress("ada");

const requestFor = (locale: "en-US" | "cs-CZ") => ({
  email: customerEmail,
  url: "https://workspace.example/api/auth/magic-link/verify?token=preview-token",
  locale,
});

describe("Magic-link email renderer", () => {
  test("embeds the bearer URL only in the rendered body", async () => {
    const rendered = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("en-US"))
    );

    expect(rendered.html).toContain("token=preview-token");
    expect(rendered.subject).not.toContain("token=");
    expect(rendered.subject).not.toContain(customerEmail);
  });

  test("puts the sign-in code alone on its own line of the text body", async () => {
    const rendered = await Effect.runPromise(
      renderMagicLinkEmail({ ...requestFor("cs-CZ"), code: "482913" })
    );

    expect(rendered.text.split("\n").map((line) => line.trim())).toContain(
      "482913"
    );
    expect(rendered.html).toContain("482913");
    expect(rendered.subject).not.toContain("482913");
  });

  test("renders the link-only email unchanged without a code", async () => {
    const linkOnly = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("en-US"))
    );

    expect(linkOnly.text).not.toMatch(/^\s*\d{6}\s*$/m);
    expect(linkOnly.text).toContain("token=preview-token");
  });
});
