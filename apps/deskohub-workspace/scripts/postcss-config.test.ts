import { expect, test } from "bun:test";
import { join } from "node:path";
import { runCommand } from "./shared/command";

const workspaceRoot = join(import.meta.dir, "..");

test("typecheck includes the PostCSS config", async () => {
  const result = await runCommand(
    ["bunx", "tsc", "--showConfig", "-p", "tsconfig.json"],
    { cwd: workspaceRoot }
  );

  expect(result.exitCode).toBe(0);
  const config = JSON.parse(result.stdout) as {
    readonly files: readonly string[];
  };
  expect(config.files).toContain("./postcss.config.mjs");
});
