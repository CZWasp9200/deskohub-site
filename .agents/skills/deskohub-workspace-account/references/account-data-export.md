# Account data export

The self-service archive behind `GET /[locale]/account/data-export` (the
website) and `GET /api/customer/account/data-export` (the customer HTTP API,
for the app). What the archive promises customers lives in
`docs/account-data-export.md`; this file covers how it is built.

## Modules

- `features/account/account-data-export-sections.ts`: the client-safe catalog
  (schema version, manifest path, the ten section paths and their manifest
  descriptions, the non-atomicity and completeness notes). The UI disclosure
  and the account E2E import it, and the UI keys its labels by path
  exhaustively. Bump `accountDataExportSchemaVersion` when a section's
  meaning changes; adding or renaming a path is a contract change for the UI
  and E2E.
- `features/account/backend/account-data-export.service.ts`:
  `AccountDataExportService.download`, the export policy
  (`AccountDataExportLimits`), and the per-section contents type
  (`AccountDataExportContents`).
- `features/account/account-data-export-route.server.ts`:
  `makeAccountDataExportGet`, used by the route file under
  `app/[locale]/(site)/(full-header)/account/data-export/route.ts`, which only
  exports `GET`.
- The customer API's `getDataExport` handler in
  `features/customer-api/customer-account-handlers.ts`.

Both adapters call `AccountDataExportService.download` and only map its
outcome to HTTP. Authorization, limits, the archive, and its file name are
the service's. A new adapter builds the service with
`AccountDataExportService.withAuthentication` (the customer API provides
`ForProvidedAuthentication` over the session its middleware read); `Live` is
the browser session's. Neither adapter adds a gate, a limit, or a refusal of
its own: the export has no release gate.

## Authorization

`download` re-authorizes from the authoritative session the way
`CustomerInvoiceService` does: `requireLinkedCustomerAccount`, then
`CurrentCustomerAccount.requireActive` read again after resolution (the
identity section comes from this session, so its account must be the resolved
one), then `requireAccountActivity`. `isCustomerAccountAccessDenial` sorts the
`CustomerAccountAccessError`: a refusal (signed out, unverified, unlinked,
review account, deletion pending or done) is
`AccountDataExportUnavailableError`; an unreadable authority is a load failure
with code `account.authority`.

That authorization is `authorizeAccountDataExport`, an Effect over
`AccountDataExportAuthority` (the account standing and the account link;
`accountDataExportAuthorityLive` in production). `download` runs it with the
service's own dependencies, and `/account/legal` offers the download through
`getAccountDataExportAvailability`
(`features/account/account-data-export-availability.server.ts`), which runs
the same Effect: `true` on success, `false` on a refusal, an unreadable
authority, or any other failure (`runWorkspaceEffectOrElse`, so a defect or
an authority or runtime that can't be built hides the control rather than
failing the page). The page passes it to
`LegalScreen` as `accountDataExportAvailable`, so the control appears for
exactly the sessions the route serves; never gate it on another read such as
the analytics preference. Like the route, the read resolves the account, so
an account whose email matches one customer is auto-linked on the page
visit. The test-utils `accountDataExportRefusals` table drives both the
service's refusal tests and the availability tests.

## Section reads

Each section reads through its owner, scoped to the linked Dotypos customer.
Reservation-keyed readers take the ids of the customer's Workspace
reservations from `WorkspaceReservationRepository.listForCustomer`, which is
customer-only: a reservation the account authored for another customer never
enters the archive. Never read `CustomerReservationHistoryService` here; it
is customer-or-author.

| Section file | Owner read |
| --- | --- |
| `identity.json` | the authorized `CustomerAccountSession` |
| `dotypos-profile.json` | `CustomerDotyposAdapter.readCustomerProfile` |
| `reservation-history.json` | `CustomerBookedReservations.listForCustomer`, each joined to the Workspace record's `product` by `dotyposReservationId` (`null` without a record) |
| `workspace-reservations.json` | `WorkspaceReservationRepository.listForCustomer` (strict `StoredReservationDetails.decode`) |
| `payments.json` | `PaymentAttemptRepository.listForReservations`, `LatePaymentRecoveryRepository.listForReservations` |
| `discount-applications.json` | `DiscountApplicationRepository.listForReservations` |
| `invoices.json` | `InvoiceRepository.listMetadataForCustomer` (never decrypts), `InvoiceEmailDeliveryRepository.listForCustomer` (customer audience only) |
| `consents.json` | `MarketingConsentLedger.find`, `LegalEvidenceEventRepository.listForReservations` (stored document hash per event; null-reservation events excluded) |
| `access-grants.json` | `ReservationAccessRepository.listForReservations` |
| `withdrawals.json` | `WithdrawalRepository.listRecordsForAccount` (by customer account, not Dotypos customer; no receipt email stored) |

Owner readers select an explicit column allowlist, order deterministically,
fetch `limit + 1` rows (`readLimitSentinel`), and fail with
`ReadLimitExceededError` before returning anything
(`shared/backend/read-limit.ts`). A new section field goes into the owner's
projection, never into an account-side query against another feature's
tables. Amounts stay `Money` objects in minor units; instants serialize as
ISO strings.

## Export policy

`AccountDataExportLimits` is a `Context.Reference` whose default is the
production policy; tests provide smaller limits with
`Layer.succeed(AccountDataExportLimits, …)`. Every limit bounds the whole
section, never one reservation's share.

| Read | Limit |
| --- | --- |
| Workspace reservations | 500 |
| Dotypos reservations | 500 |
| Payment attempts | 2000 |
| Late-payment recoveries | 500 |
| Discount applications | 2000 |
| Invoices | 500 |
| Invoice deliveries | 500 |
| Legal evidence events | 2000 |
| Access grants | 500 |

The profile and the marketing consent are single records.

## Failure and retention

- Reads are plain and sequential on `WorkspaceDatabase.db`: no transaction,
  no lock. The archive spans Dotypos and Workspace, so a database snapshot
  would not make it atomic; the manifest's non-atomicity note says so.
- Any failed read, exceeded limit, or ZIP assembly limit
  (`buildZipArchive`: 32 entries, 4 MiB per entry, 8 MiB total) fails the
  whole archive with `AccountDataExportLoadError { code, kind }`, where
  `kind` is `unreadable` or `over-limit`. The service logs only those two
  fixed values; nothing of the data or the cause.
- The archive exists only in the request's memory. No job, store, email, or
  signed URL.

## Route

`defineWorkspaceRoute` with `caller: "client"` and
`cancellation: "interrupt-on-disconnect"`. The locale is validated before the
service layer is provided, so an invalid locale answers 404 even when the
service can't be built. Responses, all private (`markPrivateResponse`:
`Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`):

- 200 `application/zip`, attachment
  `deskohub-account-data-<YYYY-MM-DD>.zip` (Prague date of `generatedAt`).
- 404 with a null body for every refusal and an invalid locale.
- 500 with a generic JSON body for a load failure, an unexpected defect, or a
  service that can't be built (`catchRecoverableCause`, logging only
  `account.data-export`). A client disconnect stays an interruption.

## Customer API

`getDataExport` answers 200 `application/zip` with the same attachment name
(`answerFileDownload`, `features/customer-api/customer-file-download.ts`),
private and uncached like every customer API response; 404
`CustomerDataExportUnavailable` for every refusal; and 503
`CustomerServiceUnavailable` for a load failure of either kind or a service
that can't be built. It spends the `dotypos-read` budget. It is a GET, so the
read stops when the app disconnects. The app shows its download row for the
`linked` account state, the sessions the service serves, and treats a 404 as
unavailable.

## Tests

- `account-data-export.service.test.ts` and
  `account-data-export-route.server.test.ts` run the real service on Layer
  fakes of every source from `account-data-export.test-utils.ts`
  (`fakeAccountDataExportSources`, `syntheticExportSources`,
  `SyntheticSourceFailure`). They cover read order, scope and limits, every
  refusal kind, every section's failure and over-limit codes, ZIP limits,
  headers, and interruption.
- `account-data-export.service.postgres.test.ts` runs the real owner layers
  on a migrated database with Dotypos and the session faked: cross-customer
  isolation, authored-for-other exclusion, customer-only deliveries,
  null-reservation legal events, exact projection keys, and exact-limit
  passes / limit + 1 fails for every bounded read.
- A new section or field updates the projection-key assertions in the
  Postgres suite.
- `getDataExport` in `features/customer-api/customer-account-handlers.test.ts`
  runs the real service over the same fakes through the customer API: the
  archive, the request's session, every refusal in
  `accountDataExportRefusals`, load failures, and an unbuildable service.

## Residual risks

- The Dotypos list pages by offset (100 per page, one request per page, no
  retry). A reservation added or removed while it is paged can shift a row
  between pages; the reader fails on a duplicate it sees, but a row that
  slipped past a page boundary is missed.
- The Dotypos list is held in memory up to the limit plus one page before the
  bound fails it.
