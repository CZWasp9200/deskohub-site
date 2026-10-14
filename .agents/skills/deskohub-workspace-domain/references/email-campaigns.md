# Email campaigns

Admin email campaigns live in `apps/deskohub-workspace/features/email-campaigns/`. The body document, templates, rendering, and content hash are under `body/`. The domain core (schema, audiences, recipient resolution, services) is in the rest of the feature, with tables in `db/schema/email-campaigns.ts`.

## Glossary

- **Campaign**: one email an admin composes and sends once. Its status moves Draft → Sending → Sent; a Failed send retries only undelivered recipients. Only a Draft can change or be deleted. **Duplicate** copies any campaign into a new Draft.
- **Purpose**: `marketing` or `operational`. Marketing campaigns reach only customers with active marketing consent (`customer_marketing_consents.withdrawn_at is null`) and carry unsubscribe links. Operational campaigns skip consent and carry a reason line: fixed localized copy unless the locale content sets `operationalReason` (trimmed, non-empty; part of the content hash).
- **Template**: a code-defined React Email layout the campaign selects by key. Admins can't edit templates.
- **Audience**: a saved, named filter tree (`AudienceFilter`): nested AND/OR groups of reservation, locale, account, Dotypos tag, and discount-group conditions. Drafts follow the audience live. An audience a Draft uses can be archived but not deleted. Unrelated to discount-code audiences.
- **Send**: the one record that freezes a campaign's recipients and snapshots the audience filter it used (`email_campaign_sends`).
- **Recipient**: a frozen Dotypos customer ID with its resolved locale and delivery status. No email is stored; delivery re-reads the Dotypos profile email and, for marketing, the consent.
- **Test send**: mail to admin-chosen addresses (the admin inbox always included), one email per covered locale, with `[TEST]` in the subject. It isn't a campaign delivery.
- **Confirmation code**: the code each test email carries. The real send needs it typed back. It's bound to the content hash (subject, preheader, bodies, template, purpose), expires after 24 hours, and a newer test send supersedes it. Five wrong codes also supersede it.

## Recipient resolution rules

- The candidate pool is the customers Workspace knows: reservations ∪ account links ∪ consent rows. Marketing narrows it to active consents.
- Local conditions run first with three-valued logic: Dotypos conditions are `unknown` until hydration, and a candidate local facts already rule out never reaches Dotypos.
- Survivors hydrate with `DotyposService.getCustomers` in sequential chunks of 100. Any Dotypos failure fails the whole resolution with a retryable `CampaignRecipientResolutionError`; never freeze a partial list.
- A reservation condition's `visit` basis dates by the Dotypos reservation start (listed for the range, then joined locally); `booking` dates by the local `reservation_confirmed_at`, so unconfirmed reservations never match a booking range. Without a status, only booked reservations count: confirmed and never cancelled, including ones whose fulfillment failed; abandoned and expired checkouts do not. An explicit admin status group replaces that default. Both bases use Prague calendar days. "Hasn't" is evaluated within the pool only.
- Locale: linked account → latest reservation → consent → `cs-CZ`. The locale condition filters on the same value.
- Excluded with a reason: missing from Dotypos, deleted customer, missing email, invalid email (`reservationCustomerEmailSchema`).
- Duplicates by trimmed, lowercased email: mail the customer who reserved most recently, then the lowest ID, and report the group.
- Outside production, refuse any send (test sends included) when a recipient is outside `@deskohub.test` (`ensureCampaignRecipientsAllowed`).

## Confirmation rules

- Store only an HMAC of the code, keyed by an HKDF derivation of the first `BETTER_AUTH_SECRETS` entry. A salted plain hash of the 40-bit code would fall to an offline search. Rotating that secret invalidates outstanding codes, so the admin repeats the test send.
- `confirm` locks the campaign row (`for update`) and, in one transaction, checks Draft, recomputes the content hash, consumes the code, and moves the campaign to Sending. Content edits update the same row, so they wait for the lock and then fail as read-only. `issue` takes the same lock before replacing the current code.
- A typed code other than the live current one counts a failed attempt against it. The fifth supersedes it (`too-many-attempts`). A rejection is returned out of the transaction rather than failing it, so the counted attempt commits.
