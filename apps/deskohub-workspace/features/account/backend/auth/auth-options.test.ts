import { describe, expect, test } from "bun:test";

describe("Better Auth options", () => {
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
