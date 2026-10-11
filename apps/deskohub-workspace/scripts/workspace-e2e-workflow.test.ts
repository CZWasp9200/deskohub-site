import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "./shared/command";
import {
  identifierNames,
  nodesOf,
  parseTrackedSource,
} from "./shared/source-ast";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowJob,
  type WorkflowStep,
  workflowStepNames,
} from "./shared/workflow-contract";

type PlaywrightCheckoutConfig =
  typeof import("../playwright.e2e.config")["default"];

type PlaywrightInstantNavigationConfig =
  typeof import("../playwright.instant-navigation.config")["default"];

// The real Playwright configs are executed (not text-scanned) and their
// resolved structure is asserted on. They run in a child process because the
// configs resolve their browser executable with a top-level await, which
// bun's test runner does not settle reliably across multiple entry files.
const loadPlaywrightConfigStructure = async <Config>(
  configModule: string
): Promise<Config> => {
  const result = await runCommand(
    [
      process.execPath,
      "-e",
      `const config = (await import(${JSON.stringify(configModule)})).default; console.log(JSON.stringify(config));`,
    ],
    { cwd: resolve(import.meta.dir, "..") }
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr);
  }
  return JSON.parse(result.stdout) as Config;
};

let cachedConfigStructure: Promise<PlaywrightCheckoutConfig> | undefined;
const playwrightConfigStructure = (): Promise<PlaywrightCheckoutConfig> => {
  cachedConfigStructure ??= loadPlaywrightConfigStructure(
    "./playwright.e2e.config"
  );
  return cachedConfigStructure;
};

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-e2e.yml"
);
const productionWorkflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/deploy-workspace-production.yml"
);

const doc = parseWorkflow(workflowPath);
const productionDoc = parseWorkflow(productionWorkflowPath);
// Format-insensitive view of the parsed workflow used for document-level
// token presence/absence checks; assertions never touch raw file text.
const serializedWorkflow = JSON.stringify(doc);
const serializedProductionWorkflow = JSON.stringify(productionDoc);
const stepNames = workflowStepNames(doc);
const allSteps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
const testJob = doc.jobs["test-e2e"];

const stepByName = (name: string): WorkflowStep => {
  const step = findStepByName(doc, name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
};

const stepsBetweenNames = (
  fromName: string,
  toName?: string
): readonly WorkflowStep[] => {
  const from = allSteps.findIndex((step) => step.name === fromName);
  const to =
    toName === undefined
      ? allSteps.length
      : allSteps.findIndex((step) => step.name === toName);
  expect(from).toBeGreaterThanOrEqual(0);
  return allSteps.slice(from, to);
};

const readTrackedJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(import.meta.dir, path), "utf8")) as T;

/** Parsed syntax tree of a tracked repository module. */
const parseTrackedModule = (path: string) =>
  parseTrackedSource(resolve(import.meta.dir, path));

const projectByName = (config: PlaywrightCheckoutConfig, name: string) =>
  config.projects.find((project) => project.name === name);

// Checkout case projects; the account lane never pays, so tail projects do
// not wait for it.
const checkoutCaseProjectNames = [
  "checkout-non-payment",
  "checkout-payment-1",
  "checkout-payment-2",
  "checkout-payment-3",
];

const jobHasConcurrencyLock = (
  job: WorkflowJob & { readonly concurrency?: unknown }
): boolean => job.concurrency !== undefined;

describe("workspace E2E workflow", () => {
  test("keeps the atomic allocator isolated from exact-SHA test code", () => {
    const tokenCheckouts = allSteps.filter((step) =>
      (step.uses ?? "").startsWith("actions/checkout")
    );
    expect(tokenCheckouts.length).toBeGreaterThan(0);
    for (const checkout of tokenCheckouts) {
      expect(checkout.with?.["persist-credentials"]).toBe(false);
    }

    // The coordinator database credential reaches the allocation action only.
    const coordinatorSecretSteps = allSteps.filter((step) =>
      JSON.stringify(step).includes(
        "secrets.WORKSPACE_E2E_COORDINATOR_DATABASE_URL"
      )
    );
    expect(coordinatorSecretSteps.length).toBeGreaterThan(0);
    for (const step of coordinatorSecretSteps) {
      expect(step.uses).toEndWith("/.github/actions/workspace-e2e-allocation");
    }

    const staleCleanup = JSON.stringify(
      stepsBetweenNames(
        "Reconcile stale Workspace E2E reservations",
        "Validate aggregate Dotypos capacity"
      )
    );
    expect(
      staleCleanup.includes("secrets.WORKSPACE_E2E_DOTYPOS_CLIENT_SECRET")
    ).toBe(true);
    expect(staleCleanup.includes("secrets.DOTYPOS_CLIENT_SECRET")).toBe(false);
    expect(
      staleCleanup.includes("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL")
    ).toBe(false);
    expect(
      staleCleanup.includes("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED")
    ).toBe(false);

    const capacity = JSON.stringify(
      stepsBetweenNames(
        "Validate aggregate Dotypos capacity",
        "Verify hosted browser runtime"
      )
    );
    expect(
      capacity.includes("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL")
    ).toBe(false);
    expect(capacity.includes("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED")).toBe(
      false
    );
  });

  test("grants each job only the token permissions it needs", () => {
    // Target resolution inherits the read-only default: it reads deployments
    // and their statuses to bind the exact-SHA preview, and the eligible PR.
    expect(doc.permissions).toEqual({
      contents: "read",
      deployments: "read",
      "pull-requests": "read",
      statuses: "read",
    });
    // Only the jobs that publish commit statuses opt into write access. A job
    // left undefined here must inherit the read-only default.
    expect(
      Object.fromEntries(
        Object.entries(doc.jobs).map(([name, job]) => [name, job.permissions])
      )
    ).toEqual({
      "resolve-target": undefined,
      "test-e2e": { actions: "read", contents: "read", statuses: "write" },
      "publish-final-status": { contents: "read", statuses: "write" },
      "publish-skipped-status": { contents: "read", statuses: "write" },
    });
  });

  test("migrates the resolved preview before capacity checks and browser setup", () => {
    const steps = testJob.steps ?? [];
    const resolveIndex = steps.findIndex(
      (step) => step.name === "Resolve Neon branch backing the preview"
    );
    const migrateIndex = steps.findIndex(
      (step) => step.name === "Migrate preview database"
    );
    const staleCleanupIndex = steps.findIndex(
      (step) => step.name === "Reconcile stale Workspace E2E reservations"
    );
    const capacityIndex = steps.findIndex(
      (step) => step.name === "Validate aggregate Dotypos capacity"
    );
    const browserIndex = steps.findIndex(
      (step) => step.name === "Verify hosted browser runtime"
    );
    const migration = stepByName("Migrate preview database");
    const runIndex = steps.findIndex(
      (step) => step.name === "Run checkout E2E"
    );

    expect(testJob.needs).toBe("resolve-target");
    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(migrateIndex).toBeGreaterThan(resolveIndex);
    expect(staleCleanupIndex).toBeGreaterThan(migrateIndex);
    expect(capacityIndex).toBeGreaterThan(migrateIndex);
    expect(browserIndex).toBeGreaterThan(migrateIndex);
    expect(runIndex).toBeGreaterThan(migrateIndex);
    // A failed migration must stop the run instead of testing a stale schema.
    expect(migration.if).toBeUndefined();
    expect(migration["continue-on-error"]).toBeUndefined();
  });

  test("classifies the synthetic main account only after a failed E2E run", () => {
    const uploadIndex = allSteps.findIndex((step) =>
      (step.uses ?? "").startsWith("actions/upload-artifact@")
    );
    const diagnosticIndex = allSteps.findIndex(
      (step) => step.name === "Classify synthetic main account state"
    );
    const releaseIndex = allSteps.findIndex(
      (step) => step.name === "Release date shard"
    );
    expect(diagnosticIndex).toBeGreaterThan(uploadIndex);
    expect(diagnosticIndex).toBeLessThan(releaseIndex);

    const diagnostic = stepByName("Classify synthetic main account state");
    const diagnosticEnv = JSON.stringify(diagnostic.env);
    expect(diagnostic.if).toBe("failure()");
    expect(diagnostic["continue-on-error"]).toBe(true);
    expect(diagnosticEnv.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(false);
    expect(diagnosticEnv.includes("WORKSPACE_E2E_PROVIDER_PERMIT")).toBe(false);
    expect(
      diagnosticEnv.includes("WORKSPACE_E2E_COORDINATOR_DATABASE_URL")
    ).toBe(false);
  });

  test("uses the allocator without a global provider lock", () => {
    // Assert on the parsed job object so a reintroduced job-level
    // concurrency lock is caught regardless of its YAML spelling or position.
    expect(jobHasConcurrencyLock(testJob)).toBe(false);

    const targetCheckoutIndex = stepNames.indexOf("Checkout exact target");
    const coordinatorCheckoutIndex = stepNames.indexOf(
      "Checkout allocation action"
    );
    const leaseIndex = stepNames.indexOf("Lease an available date shard");
    const runIndex = stepNames.indexOf("Run checkout E2E");
    const releaseIndex = stepNames.indexOf("Release date shard");

    expect(targetCheckoutIndex).toBeLessThan(coordinatorCheckoutIndex);
    expect(coordinatorCheckoutIndex).toBeLessThan(leaseIndex);
    expect(leaseIndex).toBeLessThan(runIndex);
    expect(runIndex).toBeLessThan(releaseIndex);
  });

  test("passes allocated shard and provider coordination through Turborepo", () => {
    const turbo = readTrackedJson("../../../turbo.json") as {
      readonly tasks: {
        readonly "test:e2e": { readonly passThroughEnv: string[] };
      };
    };
    const environment = turbo.tasks["test:e2e"].passThroughEnv;

    expect(environment).toContain("WORKSPACE_E2E_ALLOCATION_SHARD");
    expect(environment).toContain("GITHUB_STEP_SUMMARY");
    expect(environment).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
    expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL");
    expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED");
    expect(environment).toContain("WORKSPACE_E2E_VERCEL_TOKEN");
    expect(environment).toContain("WORKSPACE_E2E_VERCEL_PROJECT");
    expect(environment).not.toContain("WORKSPACE_E2E_RESEND_API_KEY");
  });

  test("generates the Igloohome client before Workspace E2E startup", async () => {
    const result = await runCommand(
      [
        process.execPath,
        "turbo",
        "run",
        "test:e2e",
        "--filter=deskohub-workspace",
        "--dry=json",
      ],
      {
        cwd: resolve(import.meta.dir, "../../../"),
        env: { ...process.env, TURBO_UI: "false" },
      }
    );

    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    const jsonStart = output.indexOf("{");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(output.slice(jsonStart)) as {
      readonly tasks: readonly {
        readonly dependencies: readonly string[];
        readonly resolvedTaskDefinition: {
          readonly dependsOn: readonly string[];
          readonly passThroughEnv: readonly string[];
        };
        readonly taskId: string;
      }[];
    };
    const rootTurbo = readTrackedJson("../../../turbo.json") as {
      readonly tasks: {
        readonly "test:e2e": { readonly passThroughEnv: readonly string[] };
      };
    };
    const e2eTask = graph.tasks.find(
      (task) => task.taskId === "deskohub-workspace#test:e2e"
    );

    expect(e2eTask).toBeDefined();
    expect(e2eTask?.dependencies).toEqual(
      expect.arrayContaining([
        "@deskohub/igloohome#generate",
        "deskohub-workspace#i18n:compile",
      ])
    );
    expect(e2eTask?.resolvedTaskDefinition.dependsOn).toEqual(
      expect.arrayContaining(["@deskohub/igloohome#generate", "i18n:compile"])
    );
    expect(
      [...(e2eTask?.resolvedTaskDefinition.passThroughEnv ?? [])].sort()
    ).toEqual([...rootTurbo.tasks["test:e2e"].passThroughEnv].sort());
  });

  test("keeps the Vercel log-read secret inside the account Playwright execution only", () => {
    expect(stepByName("Run checkout E2E").env?.WORKSPACE_E2E_VERCEL_TOKEN).toBe(
      `\${{ secrets.WORKSPACE_E2E_VERCEL_TOKEN }}`
    );

    // Exactly the Playwright checkout step: one env key plus its secret
    // reference, counted over the serialized parsed workflow structure.
    expect(
      serializedWorkflow.split("WORKSPACE_E2E_VERCEL_TOKEN").length - 1
    ).toBe(2);

    expect(serializedWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(
      false
    );
    expect(serializedWorkflow.includes("secrets.RESEND_API_KEY")).toBe(false);
    expect(
      serializedProductionWorkflow.includes("WORKSPACE_E2E_VERCEL_TOKEN")
    ).toBe(false);
    expect(
      serializedProductionWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")
    ).toBe(false);
    expect(serializedProductionWorkflow.includes("EMAIL_API_KEY")).toBe(false);
    expect(serializedProductionWorkflow.includes("BETTER_AUTH")).toBe(false);

    const turbo = readTrackedJson("../../../turbo.json") as {
      readonly global?: { readonly passThroughEnv?: string[] };
    };
    const turboGlobal = turbo.global?.passThroughEnv ?? [];
    expect(turboGlobal).not.toContain("WORKSPACE_E2E_VERCEL_TOKEN");
    expect(turboGlobal).not.toContain("WORKSPACE_E2E_RESEND_API_KEY");
  });

  test("runs invoice persistence after the case phase of the exact-SHA Playwright graph", async () => {
    const playwrightConfig = await playwrightConfigStructure();

    // Invoice persistence locks the invoices table, so it waits for every
    // case project instead of gating the plan or overlapping paid cases.
    expect(
      projectByName(playwrightConfig, "checkout-invoice-persistence")
        ?.dependencies
    ).toEqual(checkoutCaseProjectNames);
    expect(
      projectByName(playwrightConfig, "checkout-plan")?.dependencies
    ).not.toContain("checkout-invoice-persistence");
  });

  test("lets Playwright own checkout preparation, scheduling, and parallelism", async () => {
    const playwrightConfig = await playwrightConfigStructure();
    const entry = parseTrackedModule("workspace-e2e.ts");

    // The launcher forwards the derived Playwright environment, never the
    // raw process env.
    expect(
      nodesOf(entry.ast).some(
        (node) =>
          node.type === "SpreadElement" &&
          identifierNames(node).has("process") &&
          identifierNames(node).has("env")
      )
    ).toBe(false);

    expect(projectByName(playwrightConfig, "checkout-setup")?.teardown).toBe(
      "checkout-cleanup"
    );
    expect(
      projectByName(playwrightConfig, "checkout-plan")?.dependencies
    ).toEqual(["checkout-setup", "checkout-seed"]);
  });

  test("preserves discount seeding after the case phase", async () => {
    const playwrightConfig = await playwrightConfigStructure();
    expect(
      projectByName(playwrightConfig, "checkout-shared-fixture")?.dependencies
    ).toEqual(checkoutCaseProjectNames);
  });

  test("runs read-only navigation beside the checkout graph without gating it", async () => {
    const playwrightConfig = await playwrightConfigStructure();
    const instantNavigationConfig =
      await loadPlaywrightConfigStructure<PlaywrightInstantNavigationConfig>(
        "./playwright.instant-navigation.config"
      );
    expect(doc.jobs["publish-final-status"].needs).toEqual([
      "resolve-target",
      "test-e2e",
    ]);
    // A Vercel-skipped target keeps its waiver status instead of a final one.
    expect(doc.jobs["publish-final-status"].if).toContain(
      "needs.resolve-target.outputs.skipped != 'true'"
    );
    // As a checkout project it extended the setup phase barrier, so no
    // checkout project may run the read-only navigation tests.
    const configDir = resolve(import.meta.dir, "..");
    const instantNavigationDir = resolve(
      configDir,
      instantNavigationConfig.testDir ?? ""
    );
    expect(
      playwrightConfig.projects
        .filter(
          (project) =>
            project.name === "instant-navigation" ||
            (project.testDir !== undefined &&
              resolve(configDir, project.testDir) === instantNavigationDir)
        )
        .map((project) => project.name)
    ).toEqual([]);
    // Concurrent invocations must not clobber each other's artifacts.
    expect(instantNavigationConfig.outputDir).not.toBe(
      playwrightConfig.outputDir
    );
  });

  test("restores Bun packages from a workflow-scoped cache saved before test code runs", () => {
    const restore = stepByName("Restore Bun package cache");
    const save = stepByName("Save Bun package cache");
    expect(restore.uses).toStartWith("actions/cache/restore@");
    expect(save.uses).toStartWith("actions/cache/save@");
    expect(restore.with?.["restore-keys"]).toBeUndefined();
    expect(String(restore.with?.key)).toStartWith("workspace-e2e-bun-");
    // Only the dependency install runs before the cache entry is saved.
    const beforeSave = stepsBetweenNames(
      "Restore Bun package cache",
      "Save Bun package cache"
    );
    expect(beforeSave).toHaveLength(2);
    expect(beforeSave[1]?.run).toStartWith("bun install");
  });
});
