import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { getNexiRequestTimeoutMilliseconds } from "./nexi.config";

test("keeps the Nexi request timeout short only in production", () => {
  expect(getNexiRequestTimeoutMilliseconds("production")).toBe(5_000);
  expect(getNexiRequestTimeoutMilliseconds("preview")).toBe(30_000);
  expect(getNexiRequestTimeoutMilliseconds("development")).toBe(30_000);
});
