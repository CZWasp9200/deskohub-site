import { equal, ok } from "node:assert/strict";
import { type APIResponse, expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { m as adminMessages } from "@/features/administration/i18n";
import { m as customerMessages } from "@/features/i18n";
import { extractPdfText } from "@/shared/testing/pdf-text.test-utils";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { getDatasourceConfig } from "../config";
import { isNotFoundPage } from "../not-found-page";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { addRedaction } from "../redaction";
import {
  workspaceE2EAdministratorInvoiceCancellationPlaywrightTimeout,
  workspaceE2ETimeouts,
} from "../timeouts";
import { runAdministratorCase } from "./administrator-case";
import { makeWorkspaceE2EAdministrationIdentities } from "./identities";
import {
  expectPrivateAttachment,
  fillPaidInvoiceLine,
  openNewInvoiceForm,
  readIssuedInvoice,
  selectCustomer,
  submitInvoiceIssuance,
  waitForIssuedInvoiceId,
  withResponse,
} from "./manual-invoice";

const caseId = "administrator-invoice-cancellation";
const locale = "en-US";
// Newest first, so the case's invoice is on the list's first page.
const invoiceListPath = `/${locale}/admin/invoices?sort=issuedAt&direction=desc`;
const invoiceDetailPath = (invoiceId: string) =>
  `/${locale}/admin/invoices/${invoiceId}`;
const adminCreditNotePath = (invoiceId: string) =>
  `/${locale}/admin/invoices/${invoiceId}/corrective-document`;
const billingPath = `/${locale}/account/billing`;

test("lets an administrator cancel a manual invoice with a credit note the customer can download, then hide it from the Admin UI", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  test.setTimeout(
    workspaceE2EAdministratorInvoiceCancellationPlaywrightTimeout
  );
  const identities = makeWorkspaceE2EAdministrationIdentities<
    "aic-admin" | "aic-customer"
  >({
    ownerId: caseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const datasourceConfig = getDatasourceConfig(environment);
  await runEffect(
    runAdministratorCase({
      baseURL,
      browser,
      bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      caseId,
      caseName: "administrator invoice cancellation",
      timeoutMs: workspaceE2ETimeouts.administratorInvoiceCancellationCase,
      body: Effect.fn(function* (step, { origin, session }) {
        const customer = yield* step({
          execute: identities.seedLinkedCustomer(
            "aic-customer",
            datasourceConfig
          ),
          id: "seed-linked-customer",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        const administrator = yield* step({
          execute: Effect.gen(function* () {
            const account = yield* identities.seed("aic-admin", [
              "administrator",
            ]);
            yield* identities.signIn(account, { origin, session });
            return account;
          }),
          id: "sign-in-seeded-administrator",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: session.use("open the new invoice form", (page) =>
            openNewInvoiceForm(page, origin, locale)
          ),
          id: "open-new-invoice-form",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: session.use("select the synthetic customer", (page) =>
            selectCustomer(page, customer)
          ),
          id: "select-synthetic-customer",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        yield* step({
          execute: session.use("fill one paid invoice line", (page) =>
            fillPaidInvoiceLine(page, { price: "990.00", currency: "CZK" })
          ),
          id: "fill-paid-invoice-line",
          timeoutMs: workspaceE2ETimeouts.uiTransition,
        });
        // Issuance and cancellation are the case's state-creating
        // submissions: each is sent once and never retried. The invoice is
        // retained, as in the download case: the database keeps every issued
        // invoice and its cancellation, so cleanup expires the profile only.
        const invoiceId = yield* step({
          execute: Effect.gen(function* () {
            yield* session.use(
              "issue the manual invoice",
              submitInvoiceIssuance
            );
            const id = yield* waitForIssuedInvoiceId(session, locale);
            yield* identities.recordRetainedInvoice(id);
            return id;
          }),
          id: "issue-manual-invoice",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        const issued = yield* step({
          execute: readIssuedInvoice(invoiceId, customer),
          id: "read-issued-invoice",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        const creditNoteNumber = yield* step({
          execute: session.use(
            "cancel the invoice through its confirmation",
            cancelInvoiceFromDetail
          ),
          id: "cancel-invoice",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        addRedaction(creditNoteNumber);
        yield* step({
          execute: session.use("see the cancelled invoice listed", (page) =>
            expectCancelledListRow(page, origin, issued.invoiceNumber)
          ),
          id: "see-cancelled-list-row",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: identities.signIn(customer, { origin, session }),
          id: "sign-in-linked-customer",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: session.use(
            "download the credit note from billing",
            (page) =>
              downloadCustomerCreditNote(
                page,
                origin,
                issued.invoiceNumber,
                creditNoteNumber
              )
          ),
          id: "download-customer-credit-note",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: identities.signIn(administrator, { origin, session }),
          id: "sign-in-administrator-again",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: session.use("hide the cancelled invoice", (page) =>
            hideInvoiceFromList(page, origin, issued.invoiceNumber)
          ),
          id: "hide-cancelled-invoice",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        // The private headers are the proxy's, covered in `proxy.test.ts`.
        yield* step({
          execute: session.use(
            "find the hidden invoice's admin pages gone",
            async (page) => {
              await withResponse(
                page,
                origin,
                invoiceDetailPath(issued.id),
                async (response) => {
                  ok(
                    await isAdministrationNotFound(response),
                    "the hidden invoice's detail page must answer not found"
                  );
                }
              );
              await withResponse(
                page,
                origin,
                adminCreditNotePath(issued.id),
                async (response) => {
                  equal(response.status(), 404);
                }
              );
            }
          ),
          id: "refuse-hidden-invoice-pages",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
      }),
    })
  );
});

/**
 * Cancels the invoice from its detail page, where issuance left the browser,
 * and returns the credit note number its cancellation panel shows. A manual
 * invoice bills no reservation, so the confirmation has no reservation part.
 */
const cancelInvoiceFromDetail = async (page: Page) => {
  await page
    .getByRole("button", {
      name: adminMessages.accountingInvoiceCancelOpen({}, { locale }),
    })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
  const dialog = page.getByRole("dialog");
  const form = dialog.getByRole("form", {
    name: adminMessages.accountingInvoiceCancelFormLabel({}, { locale }),
  });
  await form.waitFor({
    state: "visible",
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  // No reservation part: its PIN and email confirmations are checkboxes.
  await expect(form.getByRole("checkbox")).toHaveCount(0);
  await form
    .getByRole("button", {
      name: adminMessages.accountingInvoiceCancelSubmit({}, { locale }),
    })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
  // The credit note's own annual series, linked from the cancellation panel.
  const creditNote = page.getByRole("link", { name: /^WS-OD-\d{4}-\d+$/ });
  await creditNote.waitFor({
    state: "visible",
    timeout: workspaceE2ETimeouts.providerTransition,
  });
  const number = (await creditNote.textContent())?.trim();
  ok(number, "the cancellation panel names its credit note");
  return number;
};

/**
 * Whether an administration page answered not found. The detail page reads
 * its invoice inside a Suspense boundary, so once the shell has flushed it
 * keeps the 200 and streams the not-found boundary instead of a 404.
 */
const isAdministrationNotFound = async (response: APIResponse) =>
  response.status() === 404 ||
  (response.status() === 200 && isNotFoundPage(await response.text()));

/** The invoice's row in the admin list, found by its number's link. */
const listRow = (page: Page, invoiceNumber: string) =>
  page
    .getByRole("table")
    .getByRole("row")
    .filter({
      has: page.getByRole("link", { name: invoiceNumber, exact: true }),
    });

const expectCancelledListRow = async (
  page: Page,
  origin: string,
  invoiceNumber: string
) => {
  await page.goto(new URL(invoiceListPath, origin).toString(), {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  const row = listRow(page, invoiceNumber);
  await expect(
    row.getByText(adminMessages.accountingInvoiceCancelledBadge({}, { locale }))
  ).toBeVisible({ timeout: workspaceE2ETimeouts.browserNavigation });
  await expect(
    row.getByRole("button", {
      name: adminMessages.accountingInvoiceHideLabel(
        { invoiceNumber },
        { locale }
      ),
    })
  ).toBeVisible({ timeout: workspaceE2ETimeouts.browserAction });
  await expect(
    row.getByRole("button", {
      name: adminMessages.accountingInvoiceCancelLabel(
        { invoiceNumber },
        { locale }
      ),
    })
  ).toHaveCount(0);
};

/**
 * The customer's billing row shows the invoice as cancelled and downloads
 * its credit note, a PDF naming the credit note's number.
 */
const downloadCustomerCreditNote = async (
  page: Page,
  origin: string,
  invoiceNumber: string,
  creditNoteNumber: string
) => {
  await page.goto(new URL(billingPath, origin).toString(), {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  const row = page
    .locator('[data-slot="invoice-row"]')
    .filter({ hasText: invoiceNumber });
  await expect(
    row.getByText(
      customerMessages.accountBillingInvoiceStatusCancelled({}, { locale }),
      { exact: true }
    )
  ).toBeVisible({ timeout: workspaceE2ETimeouts.browserNavigation });
  const href = await row
    .locator('[data-slot="invoice-corrective-document"]')
    .getAttribute("href", { timeout: workspaceE2ETimeouts.browserAction });
  ok(href, "the cancelled billing row links its credit note");
  await withResponse(page, origin, href, async (response) => {
    equal(response.status(), 200);
    expectPrivateAttachment(response, "application/pdf");
    const bytes = await response.body();
    equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    const { text } = await extractPdfText(bytes);
    ok(
      text.includes(creditNoteNumber),
      "the credit note PDF must show its number"
    );
  });
};

/** Hides the cancelled invoice through the list's confirmation. */
const hideInvoiceFromList = async (
  page: Page,
  origin: string,
  invoiceNumber: string
) => {
  await page.goto(new URL(invoiceListPath, origin).toString(), {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  await listRow(page, invoiceNumber)
    .getByRole("button", {
      name: adminMessages.accountingInvoiceHideLabel(
        { invoiceNumber },
        { locale }
      ),
    })
    .click({ timeout: workspaceE2ETimeouts.browserNavigation });
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: adminMessages.accountingInvoiceHideConfirm({}, { locale }),
    })
    .click({ timeout: workspaceE2ETimeouts.uiTransition });
  // The open dialog hides the rest of the page from the accessibility tree,
  // so the row's link stops matching before the invoice is hidden. Wait for
  // the dialog to close first; it closes only once the action has answered.
  await expect(page.getByRole("dialog")).toHaveCount(0, {
    timeout: workspaceE2ETimeouts.providerTransition,
  });
  await expect(
    page.getByRole("link", { name: invoiceNumber, exact: true })
  ).toHaveCount(0, { timeout: workspaceE2ETimeouts.providerTransition });
};
