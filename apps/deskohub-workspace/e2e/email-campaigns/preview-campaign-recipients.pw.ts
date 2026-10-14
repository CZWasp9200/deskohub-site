import "../../shared/polyfills/temporal";

import { equal, ok } from "node:assert/strict";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type BrowserContext,
  expect,
  type Page,
  type Request,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  createSyntheticCustomerProfile,
  expireSyntheticCustomerProfile,
  setSyntheticCustomerProfileTags,
} from "../account/fixtures";
import { getWorkspaceE2EMarketingDocumentHash } from "../account/marketing-document-hash";
import { makeWorkspaceE2EAdminCredential } from "../admin-basic-auth";
import {
  type ActionResponseOutcome,
  awaitActionQuiescence,
  openAdminBrowserPage,
  primePreviewBypass,
  reportAdminCaseFailure,
  retainActionResponse,
  runFinalizedCase,
  sanitizedBrowserOperation,
} from "../admin-case";
import { type DatasourceConfig, getDatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import { E2EDatabase } from "../integrations/database.service";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { pollUntil, withinWorkspaceE2EDeadline } from "../polling";
import {
  waitForReactClickHandler,
  waitForReactSubmitHandler,
} from "../react-handlers";
import { addRedaction } from "../runtime";
import { E2ETelemetryService, toE2EResult } from "../services/telemetry";
import type { WorkspaceE2EFailureReporter } from "../suite";
import {
  workspaceE2EEmailCampaignCleanupTimeout,
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
import type { DatabaseClient } from "@/db/database-client";
import {
  customerMarketingConsents,
  emailCampaignAudiences,
  emailCampaigns,
} from "@/db/schema";
import {
  type EmailCampaignPreviewPlan,
  planEmailCampaignPreview,
} from "./email-campaign-case";

const emailCampaignPreviewCaseId = "email-campaign-recipient-preview";
const savedAudiencePath = /^\/admin\/email-audiences\/(?!new$)[^/]+$/;
const savedCampaignPath = /^\/admin\/email-campaigns\/(?!new$)[^/]+$/;
const recipientPreviewPath = /^\/admin\/email-campaigns\/[^/]+\/recipients$/;

test(
  "previews the tagged synthetic customer as a draft marketing campaign recipient",
  async ({ baseURL, browser, environment, runContext, runEffect }) => {
    const credential = makeWorkspaceE2EAdminCredential(
      environment.WORKSPACE_E2E_ADMIN_BASIC_AUTH
    );
    addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
    const datasourceConfig = getDatasourceConfig(environment);
    const plan = planEmailCampaignPreview();
    const { context, origin, page } = await openAdminBrowserPage({
      baseURL,
      browser,
      caseName: "email campaign recipient preview",
      credential,
    });
    try {
      await runEffect(
        runEmailCampaignPreviewCase({
          bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
          context,
          datasourceConfig,
          origin,
          page,
          plan,
          reportFailure:
            runContext.githubRunId === undefined
              ? undefined
              : writeWorkspaceE2EFailureAnnotation,
        })
      );
    } finally {
      await context.close().catch(() => undefined);
    }
  }
);

const runEmailCampaignPreviewCase = (input: {
  readonly bypassSecret: string | undefined;
  readonly context: BrowserContext;
  readonly datasourceConfig: DatasourceConfig;
  readonly origin: string;
  readonly page: Page;
  readonly plan: EmailCampaignPreviewPlan;
  readonly reportFailure?: WorkspaceE2EFailureReporter;
}) =>
  Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    const { db } = yield* E2EDatabase;
    const { page, plan } = input;
    // Captured as soon as Dotypos returns it, so an interrupted setup still
    // retires the profile and removes its consent row.
    let customerId: DotyposCustomerId | undefined;
    let audienceId: string | undefined;
    // Registered before each submit click, so cleanup waits on the action
    // even when the submit step is interrupted before it returns.
    let audienceBarrier: Promise<ActionResponseOutcome> | undefined;
    let campaignBarrier: Promise<ActionResponseOutcome> | undefined;
    let terminalStepId: string | undefined;

    const step = (
      stepId: string,
      timeoutMs: number,
      execute: Effect.Effect<void, WorkspaceE2EError>
    ) => {
      const operation = `${emailCampaignPreviewCaseId}/${stepId}`;
      return telemetry.traceStep({
        caseId: emailCampaignPreviewCaseId,
        effect: Effect.onExit(
          withinWorkspaceE2EDeadline(execute, operation, timeoutMs),
          (exit) =>
            Effect.sync(() => {
              if (toE2EResult(exit).outcome !== "passed") {
                terminalStepId = stepId;
              }
            })
        ),
        stepId,
        timeoutMs,
      });
    };

    const browserStep = (
      stepId: string,
      timeoutMs: number,
      operation: string,
      run: () => Promise<unknown>
    ) =>
      step(
        stepId,
        timeoutMs,
        sanitizedBrowserOperation(operation, () => run().then(() => undefined))
      );

    // Submits a hydrated admin form once and retains its Server Action
    // response as the cleanup barrier before the click is issued.
    const submitAction = (
      submitLabel: string,
      retain: (barrier: Promise<ActionResponseOutcome>) => void
    ) => {
      const isActionRequest = (request: Request) =>
        request.method() === "POST" &&
        request.url().startsWith(input.origin) &&
        request.headers()["next-action"] !== undefined;
      const responsePromise = page.waitForResponse(
        (response) => isActionRequest(response.request()),
        { timeout: workspaceE2ETimeouts.uiTransition }
      );
      retain(retainActionResponse(responsePromise));
      return page
        .getByRole("button", { exact: true, name: submitLabel })
        .click({ timeout: workspaceE2ETimeouts.browserAction })
        .catch((cause: unknown) => {
          void responsePromise.catch(() => undefined);
          throw cause;
        });
    };

    const waitForPath = (path: RegExp, timeoutMs: number) =>
      page.waitForURL((url) => path.test(url.pathname), {
        timeout: timeoutMs,
        waitUntil: "commit",
      });

    const rowsAppear = (
      read: Effect.Effect<readonly unknown[], WorkspaceE2EError>,
      label: string
    ) =>
      pollUntil(
        read.pipe(Effect.map((rows) => (rows.length > 0 ? true : undefined))),
        {
          initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
          intervalMs: workspaceE2EPollIntervalMs.datasource,
          label,
          timeoutMs: workspaceE2ETimeouts.datasource,
        }
      );

    const audienceForm = page.locator("form").filter({
      has: page.getByRole("button", { exact: true, name: "Create audience" }),
    });
    const composerForm = page.locator("#campaign-composer");

    const timedBody = withinWorkspaceE2EDeadline(
      Effect.gen(function* () {
        yield* step(
          "clean-synthetic-rows",
          workspaceE2ETimeouts.cleanupAction,
          deleteSyntheticRows(db, plan, undefined)
        );
        yield* step(
          "create-tagged-customer",
          workspaceE2ETimeouts.providerTransition,
          Effect.gen(function* () {
            const createdId = yield* createSyntheticCustomerProfile(
              input.datasourceConfig,
              {
                email: plan.recipientEmail,
                firstName: plan.customerFirstName,
              }
            );
            customerId = createdId;
            addRedaction(createdId);
            yield* setSyntheticCustomerProfileTags(
              input.datasourceConfig,
              createdId,
              [plan.customerTag]
            );
          })
        );
        yield* step(
          "grant-marketing-consent",
          workspaceE2ETimeouts.cleanupAction,
          Effect.gen(function* () {
            if (customerId === undefined) {
              return yield* workspaceE2EError(
                "No synthetic Dotypos customer is available for marketing consent",
                { operation: "grant synthetic marketing consent" }
              );
            }
            const documentHash = yield* Effect.try({
              catch: () =>
                workspaceE2EError(
                  "Read marketing communications document hash failed",
                  { operation: "read marketing communications document hash" }
                ),
              try: () => getWorkspaceE2EMarketingDocumentHash(),
            });
            yield* db
              .insert(customerMarketingConsents)
              .values({
                documentHash,
                dotyposCustomerId: customerId,
                grantedAt: Temporal.Now.instant(),
                locale: "cs-CZ",
                withdrawnAt: null,
              })
              .pipe(
                Effect.mapError((cause) =>
                  toWorkspaceE2EError(
                    "grant synthetic marketing consent",
                    cause
                  )
                )
              );
          })
        );
        yield* step(
          "prime-preview-bypass",
          workspaceE2ETimeouts.browserAction,
          primePreviewBypass({
            bypassSecret: input.bypassSecret,
            context: input.context,
            origin: input.origin,
          })
        );
        yield* browserStep(
          "open-audience-form",
          workspaceE2ETimeouts.browserNavigation,
          "open the new audience admin page",
          () =>
            page.goto(`${input.origin}/admin/email-audiences/new`, {
              timeout: workspaceE2ETimeouts.browserNavigation,
            })
        );
        yield* browserStep(
          "wait-for-audience-form-hydration",
          workspaceE2ETimeouts.uiTransition,
          "wait for the hydrated audience form",
          () =>
            waitForReactSubmitHandler(
              page,
              audienceForm,
              workspaceE2ETimeouts.uiTransition
            )
        );
        yield* browserStep(
          "fill-audience-title",
          workspaceE2ETimeouts.browserAction,
          "fill the audience title",
          () =>
            audienceForm
              .getByLabel("Title", { exact: true })
              .fill(plan.audienceTitle, {
                timeout: workspaceE2ETimeouts.browserAction,
              })
        );
        yield* browserStep(
          "add-tag-condition",
          workspaceE2ETimeouts.browserAction,
          "add the synthetic Dotypos tag condition",
          async () => {
            await audienceForm
              .getByRole("button", { exact: true, name: "Add condition" })
              .click({ timeout: workspaceE2ETimeouts.browserAction });
            await page
              .getByRole("menuitem", { exact: true, name: "Dotypos tag" })
              .click({ timeout: workspaceE2ETimeouts.browserAction });
            await audienceForm
              .getByRole("textbox", { exact: true, name: "Dotypos tag" })
              .fill(plan.customerTag, {
                timeout: workspaceE2ETimeouts.browserAction,
              });
          }
        );
        yield* browserStep(
          "submit-audience",
          workspaceE2ETimeouts.browserAction,
          "activate the create audience submit control once",
          () =>
            submitAction("Create audience", (barrier) => {
              audienceBarrier = barrier;
            })
        );
        yield* browserStep(
          "wait-for-saved-audience",
          workspaceE2ETimeouts.uiTransition,
          "wait for the saved audience page",
          () => waitForPath(savedAudiencePath, workspaceE2ETimeouts.uiTransition)
        );
        yield* step(
          "assert-audience-persistence",
          workspaceE2ETimeouts.datasource,
          Effect.gen(function* () {
            const [audience] = yield* pollUntil(
              readSyntheticAudiences(db, plan).pipe(
                Effect.map((rows) => (rows.length > 0 ? rows : undefined))
              ),
              {
                initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
                intervalMs: workspaceE2EPollIntervalMs.datasource,
                label: "the synthetic email campaign audience",
                timeoutMs: workspaceE2ETimeouts.datasource,
              }
            );
            ok(audience, "the saved audience must be persisted");
            const { filter } = audience;
            ok(
              filter._tag === "Group" &&
                filter.filters.some(
                  (condition) =>
                    condition._tag === "DotyposTag" &&
                    condition.tag === plan.customerTag
                ),
              "the saved audience must target the synthetic Dotypos tag"
            );
            audienceId = audience.id;
          })
        );
        yield* browserStep(
          "open-campaign-composer",
          workspaceE2ETimeouts.browserNavigation,
          "open the new campaign admin page",
          () =>
            page.goto(`${input.origin}/admin/email-campaigns/new`, {
              timeout: workspaceE2ETimeouts.browserNavigation,
            })
        );
        yield* browserStep(
          "wait-for-composer-hydration",
          workspaceE2ETimeouts.uiTransition,
          "wait for the hydrated campaign composer",
          () =>
            waitForReactSubmitHandler(
              page,
              composerForm,
              workspaceE2ETimeouts.uiTransition
            )
        );
        yield* browserStep(
          "fill-campaign-title",
          workspaceE2ETimeouts.browserAction,
          "fill the campaign title",
          () =>
            composerForm.getByLabel("Title").fill(plan.campaignTitle, {
              timeout: workspaceE2ETimeouts.browserAction,
            })
        );
        yield* browserStep(
          "select-campaign-audience",
          workspaceE2ETimeouts.browserAction,
          "select the synthetic audience",
          async () => {
            await composerForm
              .getByRole("combobox", { exact: true, name: "Audience" })
              .click({ timeout: workspaceE2ETimeouts.browserAction });
            await page
              .getByRole("option", { exact: true, name: plan.audienceTitle })
              .click({ timeout: workspaceE2ETimeouts.browserAction });
          }
        );
        yield* browserStep(
          "fill-czech-content",
          workspaceE2ETimeouts.browserAction,
          "fill the Czech campaign content",
          async () => {
            await composerForm
              .getByRole("tabpanel")
              .getByLabel("Subject", { exact: true })
              .fill(plan.subject, {
                timeout: workspaceE2ETimeouts.browserAction,
              });
            const body = page.locator("#campaign-body-cs-CZ");
            await body.click({ timeout: workspaceE2ETimeouts.browserAction });
            await body.pressSequentially(plan.body, {
              timeout: workspaceE2ETimeouts.browserAction,
            });
          }
        );
        yield* browserStep(
          "submit-campaign-draft",
          workspaceE2ETimeouts.browserAction,
          "activate the create draft control once",
          () =>
            submitAction("Create draft", (barrier) => {
              campaignBarrier = barrier;
            })
        );
        yield* browserStep(
          "wait-for-saved-draft",
          workspaceE2ETimeouts.uiTransition,
          "wait for the saved campaign draft page",
          () => waitForPath(savedCampaignPath, workspaceE2ETimeouts.uiTransition)
        );
        yield* step(
          "assert-campaign-persistence",
          workspaceE2ETimeouts.datasource,
          Effect.gen(function* () {
            const [campaign] = yield* pollUntil(
              readSyntheticCampaigns(db, plan).pipe(
                Effect.map((rows) => (rows.length > 0 ? rows : undefined))
              ),
              {
                initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
                intervalMs: workspaceE2EPollIntervalMs.datasource,
                label: "the synthetic email campaign draft",
                timeoutMs: workspaceE2ETimeouts.datasource,
              }
            );
            ok(campaign, "the campaign draft must be persisted");
            equal(campaign.status, "draft");
            equal(campaign.purpose, "marketing");
            equal(campaign.audienceId, audienceId);
            equal(campaign.content["cs-CZ"]?.subject, plan.subject);
          })
        );
        yield* browserStep(
          "open-recipient-preview",
          workspaceE2ETimeouts.uiTransition,
          "open the recipient preview",
          async () => {
            const link = page.getByRole("link", {
              exact: true,
              name: "Preview recipients",
            });
            await waitForReactClickHandler(page, link);
            await link.click({ timeout: workspaceE2ETimeouts.browserAction });
            await waitForPath(
              recipientPreviewPath,
              workspaceE2ETimeouts.uiTransition
            );
          }
        );
        yield* browserStep(
          "assert-tagged-recipient",
          workspaceE2ETimeouts.providerTransition,
          "assert the tagged synthetic customer is the only recipient",
          async () => {
            const recipients = page.getByRole("table", { name: "Recipients" });
            await expect(
              recipients.getByRole("cell", {
                exact: true,
                name: plan.recipientEmail,
              })
            ).toBeVisible({ timeout: workspaceE2ETimeouts.providerTransition });
            await expect(recipients.locator("tbody tr")).toHaveCount(1, {
              timeout: workspaceE2ETimeouts.browserAction,
            });
          }
        );
      }),
      `${emailCampaignPreviewCaseId} e2e case`,
      workspaceE2ETimeouts.emailCampaignCase
    );

    const releaseSyntheticRows = Effect.gen(function* () {
      yield* awaitActionQuiescence({
        barrierTimeoutMs: workspaceE2ETimeouts.uiTransition,
        label: "save audience action",
        responseSettled: audienceBarrier,
        waitForTerminalEvent: rowsAppear(
          readSyntheticAudiences(db, plan),
          "the synthetic audience before cleanup"
        ),
      });
      yield* awaitActionQuiescence({
        barrierTimeoutMs: workspaceE2ETimeouts.uiTransition,
        label: "create campaign draft action",
        responseSettled: campaignBarrier,
        waitForTerminalEvent: rowsAppear(
          readSyntheticCampaigns(db, plan),
          "the synthetic campaign draft before cleanup"
        ),
      });
      yield* deleteSyntheticRows(db, plan, customerId);
    });
    const retireSyntheticCustomer = Effect.suspend(() =>
      customerId === undefined
        ? Effect.void
        : expireSyntheticCustomerProfile(input.datasourceConfig, customerId, {
            clearTags: true,
          })
    );

    yield* runFinalizedCase({
      body: timedBody,
      cleanup: withinWorkspaceE2EDeadline(
        releaseSyntheticRows.pipe(
          Effect.ensuring(retireSyntheticCustomer.pipe(Effect.orDie))
        ),
        `${emailCampaignPreviewCaseId}/cleanup`,
        workspaceE2EEmailCampaignCleanupTimeout
      ).pipe(Effect.orDie),
      trace: (effect) =>
        telemetry.traceCase({
          caseId: emailCampaignPreviewCaseId,
          effect,
          timeoutMs: workspaceE2ETimeouts.emailCampaignCase,
        }),
      onExit: reportAdminCaseFailure({
        caseId: emailCampaignPreviewCaseId,
        reportFailure: input.reportFailure,
        terminalStepId: () => terminalStepId,
      }),
    });
  });

const readSyntheticAudiences = (
  db: DatabaseClient,
  plan: EmailCampaignPreviewPlan
) =>
  db
    .select()
    .from(emailCampaignAudiences)
    .where(eq(emailCampaignAudiences.title, plan.audienceTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read synthetic email campaign audiences", cause)
      )
    );

const readSyntheticCampaigns = (
  db: DatabaseClient,
  plan: EmailCampaignPreviewPlan
) =>
  db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.title, plan.campaignTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read synthetic email campaigns", cause)
      )
    );

/**
 * Deletes the run's campaign before its audience (a draft keeps the audience
 * referenced), then the synthetic consent row, and proves none remain.
 */
const deleteSyntheticRows = (
  db: DatabaseClient,
  plan: EmailCampaignPreviewPlan,
  customerId: DotyposCustomerId | undefined
) =>
  Effect.gen(function* () {
    yield* db
      .delete(emailCampaigns)
      .where(eq(emailCampaigns.title, plan.campaignTitle))
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError("delete synthetic email campaigns", cause)
        )
      );
    yield* db
      .delete(emailCampaignAudiences)
      .where(eq(emailCampaignAudiences.title, plan.audienceTitle))
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError("delete synthetic email campaign audiences", cause)
        )
      );
    if (customerId !== undefined) {
      yield* db
        .delete(customerMarketingConsents)
        .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
        .pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("delete synthetic marketing consent", cause)
          )
        );
      const remainingConsents = yield* db
        .select({ id: customerMarketingConsents.dotyposCustomerId })
        .from(customerMarketingConsents)
        .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
        .pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("verify synthetic marketing consent cleanup", cause)
          )
        );
      equal(remainingConsents.length, 0);
    }
    equal((yield* readSyntheticCampaigns(db, plan)).length, 0);
    equal((yield* readSyntheticAudiences(db, plan)).length, 0);
  });
