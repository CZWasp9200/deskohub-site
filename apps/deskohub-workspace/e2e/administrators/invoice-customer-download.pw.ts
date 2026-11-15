import { deepEqual, equal, ok } from "node:assert/strict";
import { BigDecimal, Effect } from "effect";
import { getCustomerInvoiceStatusLabel } from "@/features/accounting/customer-invoice";
import { parseCsv } from "@/shared/testing/csv.test-utils";
import { extractPdfText } from "@/shared/testing/pdf-text.test-utils";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { getDatasourceConfig } from "../config";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { addRedaction } from "../redaction";
import {
  workspaceE2EAdministratorInvoiceDownloadPlaywrightTimeout,
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

const caseId = "administrator-invoice-customer-download";
const locale = "en-US";
// One line, so the invoice total is exactly this price.
const linePrice = "1234.50";
const lineCurrency = "CZK";

const pdfPath = (invoiceId: string) =>
  `/${locale}/account/invoices/${invoiceId}/pdf`;
const exportPath = `/${locale}/account/invoices/export`;

test("lets a customer download the invoice an administrator issued them as a PDF and in the CSV export, and refuses both signed out", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  test.setTimeout(workspaceE2EAdministratorInvoiceDownloadPlaywrightTimeout);
  const identities = makeWorkspaceE2EAdministrationIdentities<
    "aicd-admin" | "aicd-customer"
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
      caseName: "administrator invoice customer download",
      timeoutMs: workspaceE2ETimeouts.administratorInvoiceDownloadCase,
      body: Effect.fn(function* (step, { origin, session }) {
        const customer = yield* step({
          execute: identities.seedLinkedCustomer(
            "aicd-customer",
            datasourceConfig
          ),
          id: "seed-linked-customer",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        yield* step({
          execute: Effect.gen(function* () {
            const administrator = yield* identities.seed("aicd-admin", [
              "administrator",
            ]);
            yield* identities.signIn(administrator, { origin, session });
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
            fillPaidInvoiceLine(page, {
              price: linePrice,
              currency: lineCurrency,
            })
          ),
          id: "fill-paid-invoice-line",
          timeoutMs: workspaceE2ETimeouts.uiTransition,
        });
        // Creation is the one state-creating submission: it is sent once and
        // never retried. The invoice is journaled as soon as its id is known
        // and `read-issued-invoice` proves it names the journaled profile.
        // Its disposition is retention: the database rejects every update or
        // delete of an issued invoice, so cleanup expires the profile, keeps
        // the invoice, and has no submission to wait for.
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
        yield* step({
          execute: identities.signIn(customer, { origin, session }),
          id: "sign-in-linked-customer",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: session.use("download the invoice PDF", (page) =>
            withResponse(page, origin, pdfPath(issued.id), async (response) => {
              equal(response.status(), 200);
              expectPrivateAttachment(response, "application/pdf");
              const bytes = await response.body();
              equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
              const { text } = await extractPdfText(bytes);
              ok(
                text.includes(issued.invoiceNumber),
                "the PDF must show the invoice number"
              );
              ok(
                text.includes(`${linePrice} ${lineCurrency}`),
                "the PDF must show the exact total"
              );
            })
          ),
          id: "download-invoice-pdf",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: session.use("download the invoice export", (page) =>
            withResponse(page, origin, exportPath, async (response) => {
              equal(response.status(), 200);
              expectPrivateAttachment(response, "text/csv; charset=utf-8");
              const [header, ...rows] = parseCsv(
                (await response.body()).toString("utf8")
              );
              equal(header?.length, 7, "the export has seven columns");
              deepEqual(rows.map(withExactTotal), [
                [
                  issued.invoiceNumber,
                  issued.issuedOn,
                  "",
                  exactAmount(linePrice),
                  lineCurrency,
                  getCustomerInvoiceStatusLabel("paid", locale),
                  "",
                ],
              ]);
            })
          ),
          id: "download-invoice-export",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: session.use(
            "request both downloads signed out",
            async (page) => {
              await page.context().clearCookies({ name: /better-auth\./ });
              for (const path of [pdfPath(issued.id), exportPath]) {
                await withResponse(page, origin, path, async (response) => {
                  equal(response.status(), 404);
                  equal(
                    response.headers()["cache-control"],
                    "private, no-store"
                  );
                  equal((await response.body()).length, 0);
                });
              }
            }
          ),
          id: "refuse-signed-out-downloads",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
      }),
    })
  );
});

/** A decimal amount in one canonical spelling, so `99.9` equals `99.90`. */
const exactAmount = (amount: string) =>
  BigDecimal.format(BigDecimal.normalize(BigDecimal.fromStringUnsafe(amount)));

/** An export row with its total amount (the fourth cell) made canonical. */
const withExactTotal = ([
  number,
  issuedOn,
  dueOn,
  total,
  ...rest
]: string[]) => [number, issuedOn, dueOn, exactAmount(total ?? ""), ...rest];
