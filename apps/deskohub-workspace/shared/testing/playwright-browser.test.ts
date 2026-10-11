import { expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  playwrightChromiumAvailable,
  resolvePlaywrightChromiumExecutable,
} from "./playwright-browser";

test("uses the explicitly configured Playwright browser", async () => {
  expect(
    await resolvePlaywrightChromiumExecutable("/configured/chrome", undefined)
  ).toBe("/configured/chrome");
});

test("finds the hosted system browser when no path is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-playwright-"));
  const executable = join(directory, "google-chrome");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o700);

  expect(await resolvePlaywrightChromiumExecutable(undefined, directory)).toBe(
    executable
  );
});

test("lets Playwright fall back to its bundled browser", async () => {
  expect(
    await resolvePlaywrightChromiumExecutable(undefined, "/missing")
  ).toBeUndefined();
});

test("reports an installed Playwright Chromium as available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-playwright-"));
  const executable = join(directory, "chrome");
  await writeFile(executable, "#!/bin/sh\n");
  await chmod(executable, 0o700);

  expect(await playwrightChromiumAvailable(executable, "true")).toBe(true);
});

test("lets local browser tests skip without Playwright Chromium", async () => {
  expect(await playwrightChromiumAvailable("/missing/chrome", undefined)).toBe(
    false
  );
});

test("fails CI browser tests without Playwright Chromium", async () => {
  const error = await playwrightChromiumAvailable(
    "/missing/chrome",
    "true"
  ).then(
    () => null,
    (cause: unknown) => cause
  );

  expect(error).toBeInstanceOf(Error);
  expect(error).toHaveProperty(
    "message",
    expect.stringContaining("/missing/chrome")
  );
});
