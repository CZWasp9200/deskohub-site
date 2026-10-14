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
});
