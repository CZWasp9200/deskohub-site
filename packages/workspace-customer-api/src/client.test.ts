import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Result } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  customerApiClientHeader,
  makeCustomerAuthApiClient,
  makeWorkspaceCustomerApiClient,
} from "./client";
import {
  CustomerAccountLinkRequired,
  type CustomerAccountState,
  type CustomerAnalyticsConsentSync,
  CustomerDataExportUnavailable,
} from "./customer-account-api";
import { CustomerAuthRejected } from "./customer-auth-api";
import {
  type CustomerCompanyDetails,
  CustomerCompanyIdInvalid,
  CustomerCompanyNotFound,
  CustomerCompanyRegistryUnavailable,
} from "./customer-companies-api";
import {
  CustomerInvoiceId,
  type CustomerInvoiceList,
  CustomerInvoiceNotFound,
} from "./customer-invoices-api";
import { CustomerLocale } from "./customer-locale";
import {
  CustomerInvoiceNotIssued,
  CustomerReservationOrderId,
} from "./customer-reservations-api";
import {
  CustomerAccountId,
  CustomerRateLimited,
  CustomerServiceUnavailable,
  CustomerSessionRequired,
} from "./customer-session";

const baseUrl = "https://workspace.deskohub.test";
const customerEmail = testEmailAddress("customer");

/**
 * An HttpClient that records each request as a web Request and answers it
 * with `respond`.
 */
const recordingClient = (respond: (request: Request) => Response) => {
  const requests: Request[] = [];
  const client = HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.map((webRequest) => {
        requests.push(webRequest);
        return HttpClientResponse.fromWeb(request, respond(webRequest));
      }),
      Effect.orDie
    )
  );
  return { client, requests };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  client: HttpClient.HttpClient
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.result,
      Effect.provideService(HttpClient.HttpClient, client)
    )
  );

const deletionPending: CustomerAccountState = {
  kind: "deletion-pending",
  email: customerEmail,
  deletion: "pending",
  locale: null,
};

/** A saved locale a later release may serve, which this contract doesn't. */
const laterLocale = "fr-FR";

describe("makeWorkspaceCustomerApiClient", () => {
  test("sends the client header to the customer API path and decodes the account", async () => {
    const { client, requests } = recordingClient(() => json(deletionPending));

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.getAccount({ headers: {} })
      ),
      client
    );

    expect(result).toEqual(Result.succeed(deletionPending));
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/api/customer/account`,
    ]);
    expect(requests[0]?.headers.get(customerApiClientHeader.name)).toBe(
      customerApiClientHeader.value
    );
  });

  test("decodes an account whose saved locale it doesn't serve, keeping the tag", async () => {
    expect(CustomerLocale.literals).not.toContain(laterLocale);
    const account = { ...deletionPending, locale: laterLocale };
    const { client } = recordingClient(() => json(account));

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.getAccount({ headers: {} })
      ),
      client
    );

    expect(result).toEqual(Result.succeed(account));
  });

  test("keeps the client header when the caller's transform overwrites it", async () => {
    const { client, requests } = recordingClient(() => json(deletionPending));

    await run(
      Effect.flatMap(
        makeWorkspaceCustomerApiClient({
          baseUrl,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeader(customerApiClientHeader.name, "other")
          ),
        }),
        (api) => api.account.getAccount({ headers: {} })
      ),
      client
    );

    expect(requests[0]?.headers.get(customerApiClientHeader.name)).toBe(
      customerApiClientHeader.value
    );
  });

  test("decodes endpoint and middleware errors as their tagged errors", async () => {
    const linkRequired = recordingClient(() =>
      json(
        { _tag: "CustomerAccountLinkRequired", reason: "profile-missing" },
        409
      )
    );
    const signedOut = recordingClient(() =>
      json({ _tag: "CustomerSessionRequired" }, 401)
    );
    const update = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) => api.account.updateProfile({ payload: { firstName: "Ada" } })
    );

    expect(await run(update, linkRequired.client)).toEqual(
      Result.fail(
        new CustomerAccountLinkRequired({ reason: "profile-missing" })
      )
    );
    expect(await run(update, signedOut.client)).toEqual(
      Result.fail(new CustomerSessionRequired({}))
    );
  });

  test("sends the app's analytics choice and decodes the account decision it takes", async () => {
    const withdrawal: CustomerAnalyticsConsentSync = {
      kind: "withdraw",
      decidedAt: "2026-11-05T10:00:00.123Z",
    };
    const { client, requests } = recordingClient(() => json(withdrawal));
    const payload = {
      choice: { analytics: true, decidedAt: "2026-11-02T09:30:00.000Z" },
      locale: "cs-CZ",
    } as const;

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.syncAnalyticsConsent({ payload })
      ),
      client
    );

    expect(result).toEqual(Result.succeed(withdrawal));
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: "POST",
        url: `${baseUrl}/api/customer/account/analytics-consent`,
      },
    ]);
    expect(await requests[0]?.json()).toEqual(payload);
  });

  test("refuses to send an analytics choice whose date names no instant", async () => {
    const { client, requests } = recordingClient(() =>
      json({ kind: "unchanged" })
    );

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.syncAnalyticsConsent({
          payload: {
            choice: { analytics: true, decidedAt: "2026-11-02" },
            locale: "cs-CZ",
          },
        })
      ),
      client
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(requests).toEqual([]);
  });

  test("saves the analytics preference and decodes the decision's instant", async () => {
    const saved = { granted: false, decidedAt: "2026-11-05T10:00:00.123Z" };
    const { client, requests } = recordingClient(() => json(saved));

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.saveAnalyticsPreference({
          payload: { granted: false, locale: "en-US" },
        })
      ),
      client
    );

    expect(result).toEqual(Result.succeed(saved));
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: "PUT",
        url: `${baseUrl}/api/customer/account/analytics-preference`,
      },
    ]);
  });

  test("decodes an invoice PDF as its bytes, and an unissued invoice as its tagged error", async () => {
    const orderId = CustomerReservationOrderId.make(
      "019edbcf-5026-7ecc-821b-eda46998eaaa"
    );
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const { client, requests } = recordingClient(() =>
      requests.length === 1
        ? new Response(pdf, {
            headers: {
              "content-type": "application/pdf",
              "content-disposition":
                'attachment; filename="WS-FV-2026-000042.pdf"',
            },
          })
        : json({ _tag: "CustomerInvoiceNotIssued" }, 409)
    );
    const download = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) => api.reservations.getReservationInvoice({ params: { orderId } })
    );

    expect(await run(download, client)).toEqual(Result.succeed(pdf));
    expect(await run(download, client)).toEqual(
      Result.fail(new CustomerInvoiceNotIssued())
    );
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/api/customer/reservations/${orderId}/invoice`,
      `${baseUrl}/api/customer/reservations/${orderId}/invoice`,
    ]);
  });

  test("decodes the invoice list, and an invoice PDF as its bytes or not found", async () => {
    const invoiceId = CustomerInvoiceId.make(
      "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb24"
    );
    const list: CustomerInvoiceList = {
      invoices: [
        {
          id: invoiceId,
          invoiceNumber: "WS-FV-2026-000042",
          issuedOn: "2026-08-10",
          total: { amount: "258.80", currency: "CZK" },
          orderId: CustomerReservationOrderId.make(
            "019edbcf-5026-7ecc-821b-eda46998eaaa"
          ),
        },
        {
          id: CustomerInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23"),
          invoiceNumber: "WS-FV-2026-000041",
          issuedOn: "2026-08-01",
          total: { amount: "-12.5", currency: "EUR" },
        },
      ],
    };
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const responses = [
      () => json(list),
      () =>
        new Response(pdf, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition":
              'attachment; filename="WS-FV-2026-000042.pdf"',
          },
        }),
      () => json({ _tag: "CustomerInvoiceNotFound" }, 404),
    ];
    const { client, requests } = recordingClient(() =>
      responses[requests.length - 1]!()
    );
    const download = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) => api.invoices.getInvoicePdf({ params: { invoiceId } })
    );

    expect(
      await run(
        Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
          api.invoices.listInvoices({ query: {} })
        ),
        client
      )
    ).toEqual(Result.succeed(list));
    expect(await run(download, client)).toEqual(Result.succeed(pdf));
    expect(await run(download, client)).toEqual(
      Result.fail(new CustomerInvoiceNotFound())
    );
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/api/customer/invoices`,
      `${baseUrl}/api/customer/invoices/${invoiceId}/pdf`,
      `${baseUrl}/api/customer/invoices/${invoiceId}/pdf`,
    ]);
  });

  test("decodes a company lookup as the company's details or each refusal as its own error", async () => {
    const company: CustomerCompanyDetails = {
      companyName: "Ukázková firma s.r.o.",
      companyId: "12345679",
      addressLine1: "Ukázková 1",
      city: "Praha",
      zip: "10000",
      country: "CZ",
    };
    const responses = [
      () => json(company),
      () => json({ _tag: "CustomerCompanyIdInvalid" }, 400),
      () => json({ _tag: "CustomerCompanyNotFound" }, 404),
      () => json({ _tag: "CustomerCompanyRegistryUnavailable" }, 503),
      () => json({ _tag: "CustomerServiceUnavailable" }, 503),
      () => json({ _tag: "CustomerRateLimited" }, 429),
    ];
    const { client, requests } = recordingClient(() =>
      responses[requests.length - 1]!()
    );
    const lookup = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) =>
        api.companies.lookupCompany({ params: { companyId: "12345679" } })
    );

    expect(await run(lookup, client)).toEqual(Result.succeed(company));
    expect(await run(lookup, client)).toEqual(
      Result.fail(new CustomerCompanyIdInvalid())
    );
    expect(await run(lookup, client)).toEqual(
      Result.fail(new CustomerCompanyNotFound())
    );
    expect(await run(lookup, client)).toEqual(
      Result.fail(new CustomerCompanyRegistryUnavailable())
    );
    expect(await run(lookup, client)).toEqual(
      Result.fail(new CustomerServiceUnavailable())
    );
    expect(await run(lookup, client)).toEqual(
      Result.fail(new CustomerRateLimited())
    );
    expect(requests.map((request) => request.url)).toEqual(
      Array.from(
        { length: 6 },
        () => `${baseUrl}/api/customer/companies/12345679`
      )
    );
  });

  test("decodes the data archive as its bytes, and a refusal as its tagged error", async () => {
    // A ZIP's local file header signature.
    const archive = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const { client, requests } = recordingClient(() =>
      requests.length === 1
        ? new Response(archive, {
            headers: {
              "content-type": "application/zip",
              "content-disposition":
                'attachment; filename="deskohub-account-data-2026-11-15.zip"',
            },
          })
        : json({ _tag: "CustomerDataExportUnavailable" }, 404)
    );
    const download = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) => api.account.getDataExport()
    );

    expect(await run(download, client)).toEqual(Result.succeed(archive));
    expect(await run(download, client)).toEqual(
      Result.fail(new CustomerDataExportUnavailable())
    );
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/api/customer/account/data-export`,
      `${baseUrl}/api/customer/account/data-export`,
    ]);
  });

  test("uploads the avatar as one multipart file part", async () => {
    const { client, requests } = recordingClient(() =>
      json({ url: "https://res.cloudinary.test/avatar.webp", version: 3 })
    );
    const payload = new FormData();
    payload.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "avatar.png", {
        type: "image/png",
      })
    );

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.uploadAvatar({ payload })
      ),
      client
    );

    expect(result).toEqual(
      Result.succeed({
        url: "https://res.cloudinary.test/avatar.webp",
        version: 3,
      })
    );
    const request = requests[0];
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(`${baseUrl}/api/customer/account/avatar`);
    expect(request?.headers.get("content-type")).toStartWith(
      "multipart/form-data"
    );
    const file = (await request?.formData())?.get("file");
    expect(file instanceof File ? [file.type, file.size] : file).toEqual([
      "image/png",
      3,
    ]);
  });
});

describe("makeCustomerAuthApiClient", () => {
  test("calls Better Auth's paths and accepts its empty consent deletion", async () => {
    const { client, requests } = recordingClient(
      () => new Response(null, { status: 200 })
    );

    const result = await run(
      Effect.flatMap(makeCustomerAuthApiClient({ baseUrl }), (auth) =>
        auth.auth.deleteConsent({ payload: { id: "consent-1" } })
      ),
      client
    );

    expect(Result.isSuccess(result)).toBe(true);
    expect(requests[0]?.url).toBe(`${baseUrl}/api/auth/oauth2/delete-consent`);
    expect(await requests[0]?.json()).toEqual({ id: "consent-1" });
  });

  test("decodes a signed-out session as null", async () => {
    const { client } = recordingClient(() => json(null));

    expect(
      await run(
        Effect.flatMap(makeCustomerAuthApiClient({ baseUrl }), (auth) =>
          auth.auth.getSession()
        ),
        client
      )
    ).toEqual(Result.succeed(null));
  });

  test("decodes a session whose saved locale it doesn't serve, keeping the tag", async () => {
    expect(CustomerLocale.literals).not.toContain(laterLocale);
    const accountId = CustomerAccountId.make("account-1");
    const session = {
      session: {
        id: "session-1",
        userId: accountId,
        expiresAt: "2026-11-10T00:00:00.000Z",
      },
      user: {
        id: accountId,
        email: customerEmail,
        emailVerified: true,
        name: "",
        locale: laterLocale,
      },
    };
    const { client } = recordingClient(() => json(session));

    const result = await run(
      Effect.flatMap(makeCustomerAuthApiClient({ baseUrl }), (auth) =>
        auth.auth.getSession()
      ),
      client
    );

    expect(result).toEqual(Result.succeed(session));
  });

  test("decodes Better Auth's refusals by status, keeping only the fixed code", async () => {
    const unauthorized = recordingClient(() =>
      json({ message: "Unauthorized", code: "UNAUTHORIZED" }, 401)
    );
    const missingConsent = recordingClient(() =>
      json({ error: "not_found", error_description: "no consent" }, 404)
    );
    const foreignConsent = recordingClient(
      () => new Response(null, { status: 401 })
    );
    const disconnect = Effect.flatMap(
      makeCustomerAuthApiClient({ baseUrl }),
      (auth) => auth.auth.deleteConsent({ payload: { id: "consent-1" } })
    );

    expect(await run(disconnect, unauthorized.client)).toEqual(
      Result.fail(
        new CustomerAuthRejected({
          reason: "unauthorized",
          code: "UNAUTHORIZED",
        })
      )
    );
    expect(await run(disconnect, missingConsent.client)).toEqual(
      Result.fail(
        new CustomerAuthRejected({ reason: "not-found", code: "not_found" })
      )
    );
    const throttled = recordingClient(() =>
      json({ message: "Too many requests. Please try again later." }, 429)
    );
    expect(await run(disconnect, throttled.client)).toEqual(
      Result.fail(new CustomerAuthRejected({ reason: "rate-limited" }))
    );
    expect(await run(disconnect, foreignConsent.client)).toEqual(
      Result.fail(new CustomerAuthRejected({ reason: "unauthorized" }))
    );
  });
});
