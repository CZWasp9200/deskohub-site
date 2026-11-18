import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { BigDecimal, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { env } from "@/env";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { testAccountingStorage } from "@/features/accounting/backend/accounting-storage.test-utils";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceArchiveRepository } from "@/features/accounting/backend/invoice-archive.repository";
import { InvoiceCancellationRepository } from "@/features/accounting/backend/invoice-cancellation.repository";
import { makeInvoiceCancellationTestKit } from "@/features/accounting/backend/invoice-cancellation.test-utils";
import { getCustomerInvoiceStatusLabel } from "@/features/accounting/customer-invoice";
import {
  type InvoiceId,
  manualInvoiceInputSchema,
} from "@/features/accounting/manual-invoice";
import { ReviewAccounts } from "@/features/review-accounts";
import { currentRequestHeaders } from "@/shared/backend/workspace-request-context";
import { parseCsv } from "@/shared/testing/csv.test-utils";
import { extractPdfText } from "@/shared/testing/pdf-text.test-utils";
import {
  syntheticDotyposCustomerId,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { workspaceSiteConstants } from "@/shared/utils";
import { temporalInstantToPlainDate } from "@/shared/utils/temporal";
import {
  type CapturedMagicLink,
  cookieJar,
  getSessionCookie,
  HOST,
  linkAccount,
  makeTestAuth,
  signInForMagicLink,
  type TestAuth,
  userIdForEmail,
  verifyMagicLink,
} from "./backend/auth/auth-handler.test-utils";
import { CurrentCustomerAccount } from "./backend/current-customer-account";
import { CustomerAccountLinkRepository } from "./backend/customer-account-link.repository";
import { CustomerAccountSections } from "./backend/customer-account-sections";
import {
  CustomerAuthentication,
  makeAuthoritySessionRead,
} from "./backend/customer-authentication.service";
import { CustomerDotyposAdapter } from "./backend/customer-dotypos-adapter.service";
import { CustomerInvoiceService } from "./backend/customer-invoice.service";
import {
  makeCustomerCorrectiveDocumentPdfGet,
  makeCustomerInvoiceExportGet,
  makeCustomerInvoicePdfGet,
} from "./customer-invoice-download-route.server";

// Issued invoices are immutable, so the suite issues its own into a database
// no other suite lists invoices from; its logins live there too.
const postgres = await createWorkspacePostgresSuiteDatabase(
  "account_invoice_downloads"
);
afterAll(() => postgres?.close());

/**
 * The live service over the suite's database. Only the session read differs
 * from production: a Better Auth instance of the suite, built by the same
 * factory as the app's, reads the session of the request the route serves
 * from that request's own headers. A linked account never reaches Dotypos, so
 * the adapter fails the test if anything calls it.
 */
const makeInvoiceService = (auth: TestAuth) => {
  const storage = Layer.mergeAll(
    postgres!.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(postgres!.databasePool),
    AccountingSnapshotKeyService.Default
  );
  const repositories = Layer.mergeAll(
    CustomerAccountLinkRepository.Default,
    ReviewAccounts.Default,
    testAccountingStorage(postgres!.layer, AccountingSnapshotKeyService.Default)
  ).pipe(Layer.provideMerge(storage));
  const requestSession = Layer.unwrap(
    Effect.map(currentRequestHeaders, (headers) =>
      CustomerAuthentication.fromEnvironment({
        readBetterAuthSecretsRaw: () => env.BETTER_AUTH_SECRETS,
        readCurrentSession: makeAuthoritySessionRead({
          requestHeaders: Effect.succeed(headers),
          loadAuthority: async () => ({ auth }),
        }),
      })
    )
  );
  const currentAccount = CurrentCustomerAccount.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        requestSession,
        CustomerAccountSections.Default.pipe(Layer.provide(requestSession)),
        Layer.mock(CustomerDotyposAdapter, {})
      )
    )
  );
  return CustomerInvoiceService.Default.pipe(
    Layer.provide(currentAccount),
    Layer.provide(repositories)
  );
};

/** Signs a synthetic login in through a real magic link; its cookie and account. */
const signIn = async (auth: TestAuth, sentLinks: CapturedMagicLink[]) => {
  const email = testEmailAddress(`invoice-downloads-${crypto.randomUUID()}`);
  const sent = sentLinks.length;
  await signInForMagicLink(auth, email);
  const verified = await verifyMagicLink(auth, sentLinks[sent]!);
  const setCookie = getSessionCookie(verified);
  expect(setCookie).toBeDefined();
  const accountId = await userIdForEmail(email, postgres!);
  expect(accountId).toBeDefined();
  return { cookie: cookieJar(setCookie!), accountId: accountId! };
};

const signInLinked = async (
  auth: TestAuth,
  sentLinks: CapturedMagicLink[],
  label: string
) => {
  const session = await signIn(auth, sentLinks);
  const dotyposCustomerId = syntheticDotyposCustomerId(label);
  await linkAccount(session.accountId, dotyposCustomerId, postgres!);
  return { ...session, dotyposCustomerId };
};

const issueInvoice = async (
  dotyposCustomerId: string,
  options: {
    /** The input as the admin form sends it, decoded with the rest. */
    readonly payment: {
      readonly status: "due" | "paid";
      readonly date: string;
    };
    readonly lines: readonly { description: string; price: string }[];
  }
) => {
  const issuer = await Effect.runPromise(
    workspaceFixtures(postgres!.db).account("invoice-downloads-issuer")
  );
  const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
    invoiceId: crypto.randomUUID(),
    dotyposCustomerId,
    buyer: {
      kind: "person",
      legalName: "Synthetic Invoice Customer",
      address: {
        line1: "Synthetic 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    },
    deliveryEmail: testEmailAddress("invoice-downloads"),
    locale: "cs-CZ",
    serviceDate: "2026-10-01",
    payment: options.payment,
    currency: "CZK",
    lines: options.lines,
    provenance: { source: "admin-ui", actor: issuer.email },
  });
  const { invoice } = await Effect.runPromise(
    Effect.flatMap(InvoiceRepository, (invoices) =>
      invoices.issueManual({ ...input, issuedBy: issuer })
    ).pipe(
      Effect.provide(
        testAccountingStorage(
          postgres!.layer,
          AccountingSnapshotKeyService.Default
        )
      )
    )
  );
  return invoice;
};

/**
 * Cancels the invoice through the real repository, as an administrator
 * would, and then hides it from the administration's invoice list.
 */
const cancelAndHideInvoice = async (invoiceId: InvoiceId) => {
  const kit = makeInvoiceCancellationTestKit(postgres!);
  const actor = await kit.makeActor("invoice-downloads-canceller");
  const storage = Layer.mergeAll(
    postgres!.layer,
    AccountingSnapshotKeyService.Default
  );
  const { record } = await Effect.runPromise(
    kit.cancel({ invoiceId, actor }).pipe(
      Effect.tap(() =>
        Effect.flatMap(InvoiceArchiveRepository, (archives) =>
          archives.archive({ invoiceId, actor })
        )
      ),
      Effect.provide(
        Layer.mergeAll(
          InvoiceCancellationRepository.Default,
          InvoiceArchiveRepository.Default
        ).pipe(Layer.provideMerge(storage))
      )
    )
  );
  return record;
};

const locale = "en-US";

/** The day in Prague an invoice was issued, as the export writes it. */
const issuedOn = (invoice: Awaited<ReturnType<typeof issueInvoice>>) =>
  temporalInstantToPlainDate({
    instant: invoice.issuedAt,
    timeZone: workspaceSiteConstants.location.timeZone,
  }).toString();

const requestPdf = (
  service: ReturnType<typeof makeInvoiceService>,
  invoiceId: string,
  cookie?: string
) =>
  makeCustomerInvoicePdfGet(service)(
    new Request(`https://${HOST}/${locale}/account/invoices/${invoiceId}/pdf`, {
      headers: cookie ? { host: HOST, cookie } : { host: HOST },
    }),
    { params: Promise.resolve({ locale, invoiceId }) }
  );

const requestCorrectiveDocument = (
  service: ReturnType<typeof makeInvoiceService>,
  invoiceId: string,
  cookie?: string
) =>
  makeCustomerCorrectiveDocumentPdfGet(service)(
    new Request(
      `https://${HOST}/${locale}/account/invoices/${invoiceId}/corrective-document`,
      { headers: cookie ? { host: HOST, cookie } : { host: HOST } }
    ),
    { params: Promise.resolve({ locale, invoiceId }) }
  );

const requestExport = (
  service: ReturnType<typeof makeInvoiceService>,
  cookie?: string
) =>
  makeCustomerInvoiceExportGet(service)(
    new Request(`https://${HOST}/${locale}/account/invoices/export`, {
      headers: cookie ? { host: HOST, cookie } : { host: HOST },
    }),
    { params: Promise.resolve({ locale }) }
  );

const describeResponse = async (response: Response) => ({
  status: response.status,
  headers: [...response.headers.entries()].sort(),
  body: await response.text(),
});

/** A decimal amount in one canonical spelling, so `99.9` equals `99.90`. */
const exactAmount = (amount: string) =>
  BigDecimal.format(BigDecimal.normalize(BigDecimal.fromStringUnsafe(amount)));

/** An export row with its total amount (the fourth cell) made canonical. */
const withExactTotal = ([
  number,
  issued,
  due,
  total,
  ...rest
]: string[]): string[] => [
  number ?? "",
  issued ?? "",
  due ?? "",
  exactAmount(total ?? ""),
  ...rest,
];

describe.skipIf(!postgres)(
  "Customer invoice downloads through the real stack on disposable Postgres",
  () => {
    const sentLinks: CapturedMagicLink[] = [];
    // Built only inside tests: registration runs even when the suite is
    // skipped without a database.
    const setUp = async () => {
      const auth = makeTestAuth({ postgres: postgres!, sentLinks });
      const service = makeInvoiceService(auth);
      const owner = await signInLinked(auth, sentLinks, "invoice-owner");
      const paid = await issueInvoice(owner.dotyposCustomerId, {
        payment: { status: "paid", date: "2026-10-01" },
        lines: [
          { description: "Synthetic desk rental", price: "1200.50" },
          { description: "Synthetic meeting room", price: "34" },
        ],
      });
      const due = await issueInvoice(owner.dotyposCustomerId, {
        payment: { status: "due", date: "2099-12-31" },
        lines: [{ description: "Synthetic locker", price: "99.90" }],
      });
      return { auth, service, owner, paid, due };
    };

    test("downloads the customer's issued invoice as a PDF showing its number and exact total", async () => {
      const { service, owner, paid } = await setUp();

      const response = await requestPdf(service, paid.id, owner.cookie);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename="${paid.document.invoiceNumber}.pdf"`
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      const { text } = await extractPdfText(bytes);
      expect(text).toContain(paid.document.invoiceNumber);
      expect(text).toContain("1234.50 CZK");
    });

    test("exports a CSV with one row per issued invoice of the customer", async () => {
      const { service, owner, paid, due } = await setUp();

      const response = await requestExport(service, owner.cookie);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/csv; charset=utf-8"
      );
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="invoices-\d{4}-\d{2}-\d{2}\.csv"$/
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const [header, ...rows] = parseCsv(await response.text());
      expect(header).toHaveLength(7);
      const byNumber = (left: string[], right: string[]) =>
        left[0]!.localeCompare(right[0]!);
      expect(rows.map(withExactTotal).toSorted(byNumber)).toEqual(
        [
          [
            paid.document.invoiceNumber,
            issuedOn(paid),
            "",
            exactAmount("1234.50"),
            "CZK",
            getCustomerInvoiceStatusLabel("paid", locale),
            "",
          ],
          [
            due.document.invoiceNumber,
            issuedOn(due),
            "2099-12-31",
            exactAmount("99.90"),
            "CZK",
            getCustomerInvoiceStatusLabel("issued", locale),
            "",
          ],
        ].toSorted(byNumber)
      );
    });

    test("serves a cancelled invoice's credit note, also once hidden, beside its unchanged PDF and marks it cancelled in the export", async () => {
      const { service, owner, paid } = await setUp();
      const before = await requestPdf(service, paid.id, owner.cookie);
      const invoiceTextBefore = (
        await extractPdfText(new Uint8Array(await before.arrayBuffer()))
      ).text;
      const { correctiveDocumentNumber } = await cancelAndHideInvoice(paid.id);

      const response = await requestCorrectiveDocument(
        service,
        paid.id,
        owner.cookie
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename="${correctiveDocumentNumber}.pdf"`
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const { text } = await extractPdfText(
        new Uint8Array(await response.arrayBuffer())
      );
      expect(text).toContain(correctiveDocumentNumber);
      expect(text).toContain(paid.document.invoiceNumber);

      const after = await requestPdf(service, paid.id, owner.cookie);
      expect(after.status).toBe(200);
      expect(
        (await extractPdfText(new Uint8Array(await after.arrayBuffer()))).text
      ).toBe(invoiceTextBefore);

      const exported = parseCsv(
        await (await requestExport(service, owner.cookie)).text()
      );
      expect(
        exported.find((row) => row[0] === paid.document.invoiceNumber)
      ).toEqual([
        paid.document.invoiceNumber,
        issuedOn(paid),
        "",
        expect.any(String),
        "CZK",
        getCustomerInvoiceStatusLabel("cancelled", locale),
        correctiveDocumentNumber,
      ]);
    });

    test("answers the credit note of an uncancelled invoice, another customer's, an unknown id, and a signed-out request with the same private 404", async () => {
      const { auth, service, owner, paid, due } = await setUp();
      await cancelAndHideInvoice(paid.id);
      const other = await signInLinked(auth, sentLinks, "invoice-other");

      const reference = await describeResponse(
        await requestCorrectiveDocument(service, due.id, owner.cookie)
      );
      expect(reference.status).toBe(404);
      expect(reference.body).toBe("");
      expect(reference.headers).toContainEqual([
        "cache-control",
        "private, no-store",
      ]);
      for (const refusal of [
        await requestCorrectiveDocument(service, paid.id, other.cookie),
        await requestCorrectiveDocument(
          service,
          crypto.randomUUID(),
          owner.cookie
        ),
        await requestCorrectiveDocument(service, paid.id),
      ]) {
        expect(await describeResponse(refusal)).toEqual(reference);
      }
    });

    test("answers another customer's account, an unknown id, and a signed-out request with the same private 404", async () => {
      const { auth, service, paid } = await setUp();
      const other = await signInLinked(auth, sentLinks, "invoice-other");

      const foreign = await requestPdf(service, paid.id, other.cookie);
      const unknown = await requestPdf(
        service,
        crypto.randomUUID(),
        other.cookie
      );
      const signedOut = await requestPdf(service, paid.id);
      const signedOutExport = await requestExport(service);

      const reference = await describeResponse(foreign);
      expect(reference.status).toBe(404);
      expect(reference.body).toBe("");
      expect(reference.headers).toContainEqual([
        "cache-control",
        "private, no-store",
      ]);
      for (const refusal of [unknown, signedOut, signedOutExport]) {
        expect(await describeResponse(refusal)).toEqual(reference);
      }
    });
  }
);
