# Accounting documents

Invoice policy (when an invoice is required, numbering, required billing fields, delivery, post-order requests) is in the [accounting specification](../../../../apps/deskohub-workspace/docs/accounting-document-snapshots.md). Invoice administration and manual invoices belong to the administration skill. This file covers the implementation rules.

Code: `features/accounting/`; tables `accounting_document_snapshots`, `invoices`, `invoice_number_counters`, `invoice_email_deliveries`, `invoice_cancellations`, `corrective_documents`, `corrective_document_number_counters`, `invoice_cancellation_notice_deliveries`, and `invoice_archives` in `db/schema/`.

## Source snapshot

Every payment attempt, Nexi or internal, gets one encrypted, immutable source snapshot, inserted in the transaction that creates the attempt.

- Record and read snapshots only through `AccountingDocumentSnapshots` (`features/accounting/backend/accounting-document-snapshots.ts`). Checkout calls `prepare` before the attempt's transaction (strict decode, the snapshot's reservation, locale, amount and money reconciliation) and calls the returned `record` inside the transaction right after inserting the attempt (provider identity against the locked reservation row, then the active key, then the sealed insert). Taking the key only in `record` lets a call that returns an earlier attempt, such as a repeated internal payment, succeed without one. `record` requires `WorkspaceTransaction`, so a failure rolls the attempt back; it takes no lock. `PaymentLifecycleRepository.Default` requires `AccountingDocumentSnapshots`; its `Live` provides `AccountingStorage.Live` and `WorkspaceDatabase.Default`, so the repository and the snapshot module share one client and checkout imports neither the codec nor the key service. Tests seed snapshots with `recordAccountingDocumentSnapshot` (`accounting-document-snapshots.test-utils.ts`), never with hand-built ciphertext.
- Provide `InvoiceRepository` and `AccountingDocumentSnapshots` only through `AccountingStorage.Live` (`features/accounting/backend/accounting-storage.ts`): one value composing both modules over `WorkspaceDatabase.Default` and the snapshot key service, so a layer build constructs each once. It is a layer bundle (`{ Default, Live }`), not a service; the modules keep their interfaces and invoice numbering stays in `InvoiceRepository`'s transaction. Don't add a `Live` to either module or hand-compose their `Default`s. A consumer that needs only the key, such as `ManualInvoiceCreationRequests`' request digest, takes the key service directly. Tests compose the storage with `testAccountingStorage(database, keys)` (`accounting-storage.test-utils.ts`) over the suite's own database layer, merging that layer beside it when they also need `WorkspaceDatabase`.

- PostgreSQL `pgcrypto` encrypts the JSON into `encrypted_snapshot bytea`. Only the attempt and reservation IDs, `key_id`, and creation time are plaintext.
- PostgreSQL rejects every update and any delete of a paid snapshot. Terminal attempts keep theirs as evidence and for late-payment recovery. Never backfill historical attempts from current customer or catalog data.
- The JSON is versionless and decoded strictly. Never add schema-version metadata to it or its table; older versioned ciphertext is rejected, not normalized.
- The snapshot freezes the accepted price, supplier, reservation facts, reservation purpose, invoice instruction, billing identity when given, and the reservation email as the delivery target. It excludes phone, free-form messages, access codes, provider payloads, and payment tokens.
- A snapshot is not an invoice request and not an invoice. Read invoice intent only from the explicit frozen instruction, never from mutable Dotypos fields or the legacy `buyer`, which older snapshots filled from the reservation name even without a request. Snapshots without the instruction are ineligible for automatic issuance; snapshots without a delivery target can't be delivered automatically.

## Purpose and billing in checkout

- Model purpose and invoice request as a discriminated contract, not independent booleans: business always requests an invoice; personal requests one optionally. Persist the purpose as non-PII reservation metadata.
- When a personal request is off, omit billing fields instead of sending hidden or stale values.
- Carry billing details only through the encrypted checkout state and the snapshot. Never add plaintext columns, logs, traces, analytics properties, or email-template props for them.
- Keep purpose and billing out of advertised-price requests and quote fingerprints. Bind them into the checkout-attempt key, preserve them in every sealed Pay state and discount refresh, and restore them when the customer edits the reservation.

## Issued invoice

The `invoices` row, not the snapshot, proves an invoice exists. It owns the number, issue time, reservation, payment attempt, Dotypos customer ID, and an encrypted immutable document JSON.

1. Issue only after access-code delivery completes. Freeze `workspace_reservations.fulfilled_at` and use its Prague date as the fulfilment date, not the reservation date.
2. Persist the frozen billing identity to Dotypos first through the hard-failing, ETag-protected `updateCustomerBillingDetails` (`addressLine1`, `addressLine2`, `city`, `zip`, `country`, `companyName`, `companyId`, `vatId`; omitted optional fields are cleared, other customer data is untouched). Map the buyer only with `toDotyposCustomerBillingDetails` in `features/accounting/billing-identity.ts`, which manual-invoice administration also uses. Never route this through find-or-create, which tolerates update failure. A PATCH failure stops issuance. Never mutate a customer during unauthenticated Pay-state preparation.
3. Build the document JSON once from the snapshot's transaction facts plus the explicit billing identity. Never fall back to the snapshot's name-only buyer. Enforce required billing fields in the issued-document schema and repository, not only in the form or renderer.
4. Lock and increment the annual Prague-year counter and insert the invoice in one transaction (`formatInvoiceNumber`, `WS-FV-YYYY-NNNNNN`). A rolled-back issuance consumes no number; a non-transactional `nextval` sequence can't give that guarantee.

One live invoice per reservation is enforced by the database: the reservation and payment-attempt unique indexes cover only a chain's root, each replacement names its cancelled predecessor (`replaces_invoice_id`) on the same reservation, and a predecessor has at most one replacement. Repeated or concurrent issuance returns the live invoice; when the latest is cancelled it issues a replacement; it refuses while the reservation is cancelling or cancelled. Read a reservation's invoice with `findLiveByReservationId` (the one to serve or cancel) or `findLatestByReservationId` (the chain tail, cancelled or not), never by insertion time. Issue a business invoice always and a personal one only when the frozen request exists. Zero-total internal attempts qualify like provider-paid ones.

Render the PDF on demand from the issued JSON. Never persist the PDF or read current catalog, supplier, customer, or reservation data while rendering.

## VAT status

`workspaceSiteConstants.company.vatStatus` (`shared/utils/site-constants.ts`) is the one VAT setting. The snapshot freezes it as `supplier.vatStatus`, and the invoice states the status it was issued under (`invoice-presentation.ts`), never the current setting. The website footer and the customer API's `CustomerCheckoutSummary.vatStatus` (mapped in `features/customer-api/customer-checkout-summary.ts`) read the setting; the app shows the total's tax note only for `"vat-payer"`. The VAT-payer case has no approved wording yet, so the footer, invoice and app state nothing for it.

## Customer account access

`CustomerInvoiceService` (`features/account/backend/customer-invoice.service.ts`) is the only customer-facing reader of issued invoices.

- Every operation re-authorizes: `requireLinkedCustomerAccount` (over `CurrentCustomerAccount.resolve`), then `requireAccountActivity` against the database, never cookies or a cached result. A refused session (signed out, unverified, not linked, a review account, deletion pending, login gone) is `CustomerInvoicesUnavailableError`, which keeps the refusal as `account` for the customer API; an unreadable session or link is a load failure.
- Ownership is in SQL: read through `InvoiceRepository.listForCustomer` and `findForCustomer` with the resolved Dotypos customer, so another customer's invoice is never decrypted. An unknown, foreign, or malformed id is the same not-found.
- Project with `getCustomerInvoiceSummary` (`features/accounting/customer-invoice.ts`) on the Prague date from `currentPlainDate`; totals, settlement, and due dates come only from `invoice-settlement.ts`. What an order's invoice booked and when comes only from the issued document's frozen `reservation` and `quote` (`getInvoicedReservation`; whole days as Prague midnights), never from the order row, the snapshot table, or Dotypos. `CustomerInvoiceService.list` names the product with `getReservationProductName` in the request's locale, so accounting never depends on account code. Render PDFs with `renderInvoicePdfFile` and export CSV with `getCustomerInvoiceCsvColumns` through `createCsvDownloadResponse`. Customer reads never touch the email delivery ledger.
- `CustomerInvoicesLoadError` keeps a fixed `code` and logs only it, never an id, email, or a database, decryption, or renderer cause. Routes answer every refusal with one indistinguishable private 404 and a load failure with a private 500 (account skill, account domain and routes); the customer API's `invoices` group answers as its account endpoints do (account skill, customer HTTP API).
- Account deletion keeps issued invoices: the tombstone clears the account's Dotypos customer, so the deleted account reaches none, while the rows stay readable by id and customer (`customer-account-deletion.postgres.test.ts`).

## Delivery

- Send a dedicated invoice follow-up after fulfilment, never as part of the access-code email, plus an internal copy.
- Resolve the recipient from the snapshot's frozen delivery target. Never accept a client-provided recipient.
- Track customer and internal deliveries separately in `invoice_email_deliveries`; each logical send has its own stable provider idempotency key. A delivery failure retries the same document, never reissues.

## Cancellation

An issued invoice is cancelled, never changed: `InvoiceCancellationRepository.record` (`backend/invoice-cancellation.repository.ts`) locks the invoice row, issues the encrypted corrective document under the next `WS-OD` number, and claims the owed notices, all inside the caller's transaction (`WorkspaceTransaction`). Repeating it returns the existing cancellation with no claims.

- Every operator path enters through `InvoiceCancellationService` (`backend/invoice-cancellation.service.ts`). `plan` and `planForReservation` read the facts a confirmation shows; reading decrypts the invoice, so an unreadable document fails `document_unavailable` before any claim or provider call. `cancelStandalone` cancels an invoice without a live reservation (manual, or a reservation cancelled before invoice cancellation existed): it locks the reservation row before the invoice row, the same order as reservation cancellation and issuance. `recordForReservation` cancels the live invoice inside the reservation's completion transaction. `deliverNotices` runs after the commit; a failed notice is logged and shown, never a failure of the cancellation. `retryNotices` reclaims failed or stale notices.
- `InvoiceAdministrationService.cancel` routes on the plan: an invoice whose reservation is live goes through `ReservationAdministrationService.cancel` with `confirmedConsequences`, so both are cancelled in one completion; an invoice whose reservation's cancellation is under way is refused. Never cancel a live reservation's invoice on its own.
- `ReservationAdministrationService.cancel` checks the invoice plan in the claim's transaction, after the claim and before the provider call: the claim's row lock makes issuance wait and issuance refuses a cancelling reservation, so the checked invoice is the one the completion cancels. An unreadable invoice stops with `invoice_unavailable`, and `confirmedConsequences` that miss the live invoice or an owed customer notice fail `confirmation_stale`; either rolls the claim back. Callers that omit `confirmedConsequences` (released `dhw`) skip that check. The completion transaction marks the reservation cancelled and records the invoice cancellation, and its customer-notice check is confirmed by the claim-time check: refusing after the provider cancelled would strand the reservation.
- The customer notice is owed when the original customer invoice email was ever accepted (`wasInvoiceSentTo`) or is processing (`isCustomerCancellationNoticeOwed`). Original invoice email claims share-lock the invoice row, so they serialize with `record`.
- Hiding is `invoice_archives`; its foreign key to `invoice_cancellations` refuses a live invoice. Admin UI reads pass `{ includeArchived: false }` to `InvoiceAdministrationService.get`/`getPdf`, which then answer not found, and the list leaves archived invoices out unless `includeArchived`; the administration API reads with `true`. Customer reads ignore hiding (`customerInvoiceVisibility`, `isVisibleToCustomer`).
- A cancellation record keeps the actor's login email in a `sensitiveText` column; the account id is set null when the account is deleted.

## Post-order request

The protected page (`app/[locale]/(site)/(minimal-header)/reservation/invoice/[orderId]/page.tsx`, action `features/accounting/actions/manage-post-order-invoice.ts`) reuses the reservation-access token claims and secret with its own route.

- Verify the capability before any database or provider lookup, then recheck locale, payment, fulfilment, active attempt, snapshot, recipient, purpose, and eligibility on the server. Run BotID before every mutation.
- Offer creation only for an eligible paid personal reservation without a request or invoice. With an invoice, offer only a customer resend, never another internal copy.
- Sequence: Dotypos billing PATCH, idempotent issuance, delivery to the frozen email. A database failure after the PATCH is safe to retry.
- Without a trustworthy snapshot or recipient, show the support fallback instead of rebuilding facts from current data.

## Keys

`ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID` names the active key. Each key is its own immutable Vercel Sensitive variable, `ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_<ID>`; `pgcrypto` treats it as a passphrase. Each row's `key_id` selects the key for decryption.

To rotate:

1. Generate a new 32-byte key and escrow it in the company password manager before adding it to Vercel. Vercel can't reveal it later, and ciphertext is unrecoverable without it.
2. Add the variable and a statically named `process.env` entry in `accountingDocumentSnapshotSecrets` in `env.ts`. Next doesn't inline computed env names.
3. Deploy with the old key still present.
4. Switch `ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID` in a second deployment.
5. Keep every old key and registry entry while any snapshot it encrypted must stay readable.

## SQL logging

- Seal and open snapshots and invoice documents only through `sealedAccountingJson` (`features/accounting/backend/sealed-accounting-json.ts`), declared once per record kind (`sealedAccountingDocumentSnapshots`, `sealedInvoiceDocuments`), both private to the accounting backend. It picks the key (active to seal, the row's `key_id` to open), marks plaintext and every key with `sensitiveDatabaseParameter`, runs the encrypting and decrypting statements untraced, decodes strictly, and fails with one `AccountingRecordUnavailable` whose `reference` names the kind of id and whose cause is censored. Don't blanket-redact unrelated parameters, and don't call `pgp_sym_encrypt` or `pgp_sym_decrypt` elsewhere.
- Extend the shared structured-log censor (`shared/backend/logging/censorship.ts`) and its nested request and error tests before carrying a new billing field through provider calls.
- PostgreSQL server logging sits outside the application censor. Before relying on encryption in a new database, confirm statement and duration logging don't record bind values and that `log_parameter_max_length` and `log_parameter_max_length_on_error` are `0`. Treat an unknown managed-Postgres policy as a blocker.
