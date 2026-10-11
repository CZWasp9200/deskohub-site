import { describe, expect, test } from "bun:test";
import { authOptions, betterAuthMagicLinkOptions } from "./auth-options";

describe("Better Auth options", () => {
  // The Postgres handler test cannot observe this flag on its own: the
  // hashed verification identifier already hides a plain magic-link token.
  test("stores only a hash of the magic-link token", () => {
    expect(betterAuthMagicLinkOptions.storeToken).toBe("hashed");
  });

  test("keeps passwords and social providers disabled while deletion is enabled", () => {
    expect(authOptions.emailAndPassword?.enabled).toBe(false);
    expect(authOptions.socialProviders).toBeUndefined();
    expect(authOptions.user?.deleteUser?.enabled).toBe(true);
    expect(
      authOptions.user?.additionalFields?.deletionRequestedAt
    ).toMatchObject({
      type: "date",
      required: false,
      input: false,
    });
  });

  test("stays connectionless so schema generation can import it", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const text = await fs.readFile(
      path.join(import.meta.dir, "auth-options.ts"),
      "utf8"
    );
    expect(text).not.toMatch(/@\/env/);
    expect(text).not.toMatch(/server-only/);
    expect(text).not.toMatch(/betterAuth\(/);
  });
});
