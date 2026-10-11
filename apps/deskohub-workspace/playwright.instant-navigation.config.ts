import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import {
  workspaceE2EPlaywrightDefaults,
  workspaceE2EPlaywrightReporter,
} from "./e2e/playwright-defaults";
import { workspaceE2ETimeouts } from "./e2e/timeouts";

// Read-only navigation runs as its own invocation beside the checkout graph:
// it needs no lease or run context and must not gate checkout setup.
export default defineConfig({
  ...workspaceE2EPlaywrightDefaults,
  outputDir: "./e2e-artifacts/instant-navigation",
  reporter: workspaceE2EPlaywrightReporter("Workspace instant navigation E2E"),
  testDir: "./e2e/instant-navigation",
  testMatch: "**/*.pw.ts",
  timeout: workspaceE2ETimeouts.browserNavigation,
  workers: 2,
});
