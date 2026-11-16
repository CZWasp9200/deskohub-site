import { equal, match } from "node:assert/strict";
import { type APIResponse, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { invoices } from "@/db/schema/invoices";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalInstantToPlainDate } from "@/shared/utils/temporal";
import { waitForPageUrl } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { addRedaction } from "../redaction";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EAdministrationLinkedAccount } from "./identities";

// The manual invoice an administrator issues in the Admin UI, shared by the
// administration cases that start from one. The form's controls are found by
// their en-US labels, as the download case always did, so callers drive the
// form on the en-US route.

type IssuedInvoice = {
  readonly id: string;
  readonly invoiceNumber: string;
  /** The day in Prague it was issued, as the export writes it. */
  readonly issuedOn: string;
};

const reviewButton = (page: Page) =>
  page.getByRole("button", { name: "Review invoice" });

/** Opens the Admin UI's new invoice form and waits until it can be reviewed. */
export const openNewInvoiceForm = async (
  page: Page,
  origin: string,
  locale: Locale
) => {
  await page.goto(new URL(`/${locale}/admin/invoices/new`, origin).toString(), {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  await reviewButton(page).waitFor({
    state: "visible",
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
};

/** Fills the form's one line as already paid, so the total is exactly `price`. */
export const fillPaidInvoiceLine = async (
  page: Page,
  line: { readonly price: string; readonly currency: string }
) => {
  await page.getByLabel("Already paid").check({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await page.getByLabel("Description 1").fill("Synthetic desk", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await page.getByLabel("Price").fill(line.price, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await page.getByLabel("Currency").selectOption(line.currency, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
};

/**
 * Reviews the form and issues the invoice: the one state-creating submission,
 * sent once and never retried.
 */
export const submitInvoiceIssuance = async (page: Page) => {
  await reviewButton(page).click({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create and send invoice" })
    .click({ timeout: workspaceE2ETimeouts.uiTransition });
};

/** Waits for the issued invoice's page and reads the invoice's id from it. */
export const waitForIssuedInvoiceId = Effect.fn("waitForIssuedInvoiceId")(
  function* (session: E2EBrowserSession, locale: Locale) {
    const issuedInvoicePath = new RegExp(
      `^/${locale}/admin/invoices/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`
    );
    const url = yield* waitForPageUrl({
      description: "issued invoice page",
      matches: (candidate) =>
        issuedInvoicePath.test(new URL(candidate).pathname),
      session,
      timeoutMs: workspaceE2ETimeouts.providerTransition,
    });
    const id = issuedInvoicePath.exec(new URL(url).pathname)?.[1];
    if (!id) {
      return yield* workspaceE2EError(
        "The issued invoice page names no invoice",
        { operation: "issue manual invoice" }
      );
    }
    addRedaction(id);
    return id;
  }
);

/**
 * Searches the administration's customer lookup for the profile's exact
 * synthetic recipient and selects its one result. The lookup only reads, so
 * a search that doesn't list the new profile yet is repeated until the
 * step's deadline ends it.
 */
export const selectCustomer = async (
  page: Page,
  customer: WorkspaceE2EAdministrationLinkedAccount
) => {
  const select = page.getByRole("button", { name: "Select", exact: true });
  await page
    .getByRole("searchbox", { name: "Name or email" })
    .fill(customer.email, { timeout: workspaceE2ETimeouts.browserAction });
  const deadline = Date.now() + workspaceE2ETimeouts.providerTransition;
  for (;;) {
    await page
      .getByRole("button", { name: "Search", exact: true })
      .click({ timeout: workspaceE2ETimeouts.browserAction });
    try {
      await select.first().waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
      break;
    } catch (error) {
      // Not listed yet: search again until the step's deadline.
      if (Date.now() >= deadline) throw error;
    }
  }
  equal(
    await select.count(),
    1,
    "the synthetic recipient matches one customer"
  );
  await select.click({ timeout: workspaceE2ETimeouts.browserAction });
  await expect(page.getByLabel("Invoice email")).toHaveValue(customer.email, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
};

/** The issued invoice's row, which must belong to the case's customer. */
export const readIssuedInvoice = Effect.fn("readIssuedInvoice")(function* (
  invoiceId: string,
  customer: WorkspaceE2EAdministrationLinkedAccount
) {
  const { db } = yield* E2EDatabase;
  const [row] = yield* runDatabaseOperation(
    "read issued invoice",
    db
      .select({
        dotyposCustomerId: invoices.dotyposCustomerId,
        invoiceNumber: invoices.invoiceNumber,
        issuedAt: invoices.issuedAt,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
  );
  if (row?.dotyposCustomerId !== customer.customerId) {
    return yield* workspaceE2EError(
      "The issued invoice does not belong to the synthetic customer",
      { operation: "read issued invoice" }
    );
  }
  addRedaction(row.invoiceNumber);
  return {
    id: invoiceId,
    invoiceNumber: row.invoiceNumber,
    issuedOn: temporalInstantToPlainDate({
      instant: row.issuedAt,
      timeZone: workspaceSiteConstants.location.timeZone,
    }).toString(),
  } satisfies IssuedInvoice;
});

/** Requests `path` with the browser session's cookies and disposes the body. */
export const withResponse = async (
  page: Page,
  origin: string,
  path: string,
  inspect: (response: APIResponse) => Promise<void>
) => {
  const response = await page.request.get(new URL(path, origin).toString(), {
    maxRedirects: 0,
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  try {
    await inspect(response);
  } finally {
    await response.dispose();
  }
};

export const expectPrivateAttachment = (
  response: APIResponse,
  contentType: string
) => {
  const headers = response.headers();
  equal(headers["content-type"], contentType);
  match(headers["content-disposition"] ?? "", /^attachment; filename="/);
  equal(headers["cache-control"], "private, no-store");
};
