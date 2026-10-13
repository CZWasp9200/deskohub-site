---
name: deskohub-workspace-account
description: Workspace customer account, Better Auth, magic link, auth persistence, profile, account deletion, and reservation history handling.
---

# Workspace customer accounts

## Identity boundary

- Better Auth runs inside the Workspace application on the existing
  branch-specific Neon database. Do not add a second auth database, a managed
  auth service, legacy Stack Auth, or a generic auth provider abstraction.
- Better Auth owns the customer account: immutable login email, verification,
  sessions, and magic-link credentials. Its tables live in the dedicated
  `auth` PostgreSQL schema. Dotypos owns the customer profile: required first
  name, optional last name, optional phone, optional personal or business
  billing, and live reservation facts.
- Workspace stores only the one-to-one opaque ID mapping in
  `public.customer_account_links`. Never persist another copy of profile data
  or duplicate auth data elsewhere.

## Persistence

- Keep Drizzle as the only migration authority. Generate the auth tables and
  `customer_account_links` with Drizzle tooling from the checked-in schema;
  never apply Better Auth runtime migrations and never hand-edit snapshots.
- Feed Better Auth from the existing singleton `pg.Pool` through the
  conventional node-postgres Drizzle facade and the Relations-v2 adapter with
  `schemaName: "auth"`. Never create, attach, or close a second pool, and
  never pass the Effect Drizzle client to Better Auth.
- Keep the connectionless auth options module as the single source of
  table-shaping choices (`rate_limit` storage, `deletionRequestedAt`, session
  fields) shared by schema generation and the runtime auth instance.
- Keep Better Auth model names and schema types private to the account and
  database boundary. Domain code sees only `CustomerAccountId` and
  `DotyposCustomerId`.
- Timestamps decode as `Date` for Better Auth; keep `timestamptz` columns and
  the cleanup indexes on `session.expires_at`, `verification.expires_at`, and
  `rate_limit.last_request`. The daily cleanup deletes expired session,
  verification, and rate-limit rows with ordinary set-based SQL.
- Protected production-derived Neon preview branches may inherit Better Auth
  login email, pending-verification email, and short-lived rate-limit IP keys.
  Preview fixtures and all Dotypos profile and reservation data stay synthetic;
  no sanitizer and no alternate branch procedure.

## Resolution contract

- Keep `CustomerAccountResolver` as the public, replaceable
  identity-to-customer capability for authenticated route composition and
  provider-independent tests. `CustomerAccountResolver.resolve` returns only
  `CustomerAccountId` and `DotyposCustomerId`, without exposing session or
  profile data. `resolveCurrentCustomerAccount()` is the Live-wired account
  page convenience: it returns `{ account, autoLinked }`, where `autoLinked`
  is true only when this resolution claimed the link to an existing
  exact-email customer. The account page uses that to record a sign-up
  referral; keep other callers on `resolve`.
- Require the authoritative current session and verified email. Resolve the
  profile in a fixed order: an existing durable link wins; one unique active
  exact-email profile links; one unique expired profile reactivates first and
  only then claims the link, so a failed reactivation leaves the link
  unreserved and retryable; no match requires profile completion and creates a
  Dotypos profile only afterward; ambiguous, deleted, unusable, or
  already-claimed profiles return the common support state.
- Claim links with database uniqueness and conflict rereads so same-account
  races are idempotent and a customer claimed by another account is rejected.
  A `linked` claim reports `created` only for the call that inserted the link.
  `CustomerProfileService.create` returns `{ account, profile, created }`.
  An optional signup referral passed to `claim` is written in the link's
  transaction (see the referrals skill).
- Keep authentication-not-configured, unauthenticated, unverified-email,
  link-required, and unavailable as a closed public error contract. Attach only
  fixed, non-PII internal failure codes so Auth, link reads, Dotypos lookup,
  claims, locks, and deletion remain distinguishable in operator logs. Never
  retain raw provider or database failures as account error causes.
- Do not create a Dotypos customer from Auth data; Dotypos customer creation
  requires additional contact input.

## Routes, profile, and deletion

- Serve Better Auth through its official GET/POST handler at
  `/api/auth/[...all]` with `Cache-Control: private, no-store`, and keep every
  page and Server Action re-checking the authoritative database session; the
  proxy and cookies are not the authorization boundary.
- The account layout's `@modal` slot owns only the intercepted
  `(..)reservation/{status,access}/[orderId]` modals. `@modal/page.tsx`
  renders nothing at `/account`, and `@modal/default.tsx` renders nothing on
  hard navigation to the other account routes. Do not add a catch-all slot
  page. Every route into `/account/legal` and `/account/deleted` starts with
  the modal closed: the dialog makes the background inert, closing it goes
  back to `/account`, and deletion leaves through a document navigation. If a
  modal ever links to another account route, add an explicit null slot page
  for that route.
- Build account and sign-in URLs with `features/account/routes.ts`. Its
  helpers pass Next's generated `/[locale]/...` route patterns to
  `getLocalizedPagePath` so typecheck proves the pages exist; the app does not
  enable `typedRoutes`. The header account button links straight to sign-in for anonymous visitors and
  to `/account` for signed-in customers. Its href is an uncached
  `isCustomerSignedIn` promise that the header resolves with `use()` inside
  `Suspense`, and the sign-in href is the fallback. The static shell never
  depends on the session, and a failed session check reads as signed out.
  Sign-in and sign-out stay document navigations so the header re-reads the
  session. The `/account` client redirect remains only for direct or stale
  navigations.
- Use a single magic-link form for sign-in and implicit sign-up. Configure
  hashed token storage and keep the bearer URL out of logs, traces, and
  provider metadata.
- Render account and auth pages dynamically. The profile is Dotypos state:
  completion and edits update the required first name and the optional last
  name, phone, and personal or business billing there, never the auth user.
  The verified login email is immutable because it is the reservation-linking
  trust boundary; profile input never accepts an email.
- Run deletion only through Better Auth's public delete endpoint; it is the
  sole identity-deletion path. Require explicit destructive confirmation in
  the UI, then let the endpoint's `beforeDelete` hook take the account
  advisory lock, persist the `deletionRequestedAt` marker, and expire the
  linked Dotypos profile with a fresh ETag under the lock. Tolerate a
  definitively missing or deleted provider profile, and throw on a retryable
  provider failure before Better Auth removes the identity rows; the link row
  is then removed by its cascade. Serialize resolution, profile edits, and
  deletion with the advisory lock and re-read authority inside the lock. The
  marker blocks profile, reservation, checkout, and resolver activity but
  permits reauthentication, logout, and delete retry. Never delete retained
  Dotypos reservations, payments, invoices, or legal evidence.
- The account advisory lock is not reentrant. Code already running under
  `OptionalAccountActivityGuard` (such as reservation submission) must read
  the linked contact with `CustomerAccountContactService.current`, which only
  finds an existing link and never claims, resolves, or locks. Never call
  `resolveCurrentCustomerAccount` inside the guard; it would wait on the lock
  the guard already holds.

## Protected-preview E2E

- Run account E2E against the immutable protected Vercel preview for the exact
  SHA and its matching Neon branch. Never use a separate auth database, a
  static preview URL, or a runtime bypass.
- Keep browser diagnostics opt-in: the account runner requests no automatic
  screenshots, traces, videos, HARs, or console/network diagnostics. The lane
  may capture only explicit allowlisted stable-page PNGs from its synthetic
  browser context for PR review; keep magic links, cookies, storage state, HTML,
  and traces out of artifacts, validate fixed page paths and URLs before
  capture, and upload PNGs only.
- Deliver auth magic links through the shared `@deskohub/email`
  `EmailServiceTag.RecipientRouted` machinery, which owns sending, retry, and the
  recipient-based provider routing used by every Workspace email: mail
  addressed only to `EMAIL_TEST_DOMAIN` test recipients goes to Console, and
  all other mail, including Resend's `resend.dev` simulator, goes to Resend. Auth owns the template, the synthetic recipient
  pattern, and the gated raw-log envelope. Mark every magic-link message
  `sensitiveContent` so bearer content stays suppressed in Console output.
  When the runtime is Vercel Preview, the recipient exactly matches
  `delivered+<run-id>-<label>@<EMAIL_TEST_DOMAIN>` (strict local-part
  pattern, other domains rejected), and Console accepted the send, the app feature emits
  one gated raw-`console.log` line (outside the Effect/OTel censorship layer)
  under `account.magic-link.preview-e2e` carrying the rendered TEXT body with
  its bearer link. This is one of two explicitly authorized exceptions to
  the no-bearer-material logging rule (local development below is the
  other), and only for non-PII synthetic preview auth link material. When an email key is configured, every real recipient goes to Resend with the fixed
  censored delivery codes and no link logging. Production and Preview env
  validation require `EMAIL_API_KEY`; only development may omit it, and then
  every message, real recipients included, goes to Console with bearer
  content suppressed by the shared provider. There is no provider selection
  setting.
- Local development is the second, user-authorized exception: when
  `VERCEL_ENV` is `development` and `NODE_ENV` is `development` (only
  `next dev`; Vercel builds run `production` and `bun test` runs `test`),
  and Console accepted the send, the same emitter prints one
  `account.magic-link.development` line with the recipient and bearer URL
  so a developer can sign in without a Resend key. Any recipient qualifies
  because the link only reaches Console on the developer's own machine;
  Resend-delivered links are never printed. `magicLinkDeliveryEnvironment`
  in `send-magic-link-email.ts` derives both flags, and
  `emitAuthorizedMagicLinkLine` is the only account-backend `console.log`
  (`account-boundary.test.ts` enforces this). Never extend either line to
  Preview real recipients or Production, and do not loosen the shared
  Console provider, which Boardgame Bar also uses. The runner
  retrieves the link through the Vercel runtime log lookup using
  `WORKSPACE_E2E_VERCEL_TOKEN`, which lives only in the protected
  `workspace-checkout-e2e` GitHub environment and never enters Vercel or
  application configuration. Use synthetic recipients, keep links and tokens
  in memory, and register the synthetic recipient and the retrieved link
  with the E2E redactor. Never expose the production email credential. Do not
  provision an isolated synthetic tenant; do not use tunnels or webhook
  capture.
- The Playwright lifecycle must cover anonymous protection, invalid and
  replayed links, no-match profile completion, profile updates with immutable
  email, active and expired profile linking, the support state, current and
  past history, current-device logout and returning login, stale-session
  reauthentication, confirmation-gated deletion, provider-first expiration,
  session and link removal, and fresh sign-up after deletion.
- Keep provider-independent Postgres tests for same-account convergence, two
  accounts claiming one Dotypos customer, deletion racing resolution, and
  timestamp decoding. Run them against the migrated disposable database so
  cascades, unique constraints, and the real advisory lock are all exercised.
- Missing credentials may block the completion gate; do not add a runtime
  bypass while they are absent.

## Deployment checklist

- Add only environment-scoped auth secrets and mail authority to the existing
  Vercel, Neon, Resend, and cron paths. Configure fail-closed
  `BETTER_AUTH_SECRETS`, trusted-host allowlists, and send-only production
  mail per environment; never derive a secret from a public deployment
  identifier.
- Release additively: stage the build, migrate the branch, then promote. Roll
  back code without reversing account data.

## References

- [Better Auth replacement inventory](references/better-auth-replacement-inventory.md)
- [Customer-account stack dependencies](references/customer-account-stack-dependencies.md)
- [Better Auth integration and security constraints](references/better-auth-integration-security.md)
- [Magic-link delivery and protected-preview retrieval](references/magic-link-delivery-preview-retrieval.md)
- [Customer-account data retention contract](references/auth-data-retention-contract.md)
- [Better Auth data minimization in Neon](references/better-auth-pii-minimization.md)
- [Avatar media storage implementation](references/avatar-media-storage.md)
- [Neon preview branches containing authentication PII](references/neon-preview-branch-pii-controls.md)
- [PostHog identity and privacy boundary](references/posthog-identity-privacy.md) for analytics consent, identity transitions, privacy fields, retention, flags, or connector questions.
- https://better-auth.com/docs/integrations/next
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/plugins/magic-link
- https://better-auth.com/docs/concepts/database
