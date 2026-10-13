# Better Auth configuration

## Where things live

| Concern | Location |
| --- | --- |
| Connectionless options shared by schema generation and runtime | `features/account/backend/auth/auth-options.ts` |
| Runtime instance, hooks, plugins, delivery wiring | `features/account/backend/auth/auth-server.ts` |
| Server singleton | `features/account/server/auth.server.ts` |
| Browser client (the only allowed `better-auth/client` import) | `features/account/auth.client.ts` |
| Host allowlist, secrets parsing | `features/account/backend/auth/auth-hosts.ts`, `auth-secrets.ts` |
| Drizzle auth schema and its test | `db/schema/auth.ts`, `db/schema/auth.test.ts` |
| node-postgres facade over the shared pool | `db/auth-database-client.ts` |
| Expired-row cleanup | `features/account/backend/auth/auth-cleanup.service.ts`, `app/api/cron/workspace/auth-cleanup/route.ts` |

## Persistence

- Feed Better Auth from the singleton `workspaceDatabasePool` through the
  node-postgres Drizzle facade (`makeAuthDatabase`) and the
  `@better-auth/drizzle-adapter/relations-v2` adapter with
  `schemaName: "auth"`. The app's Effect Drizzle client returns Effects, which
  the adapter can't await, so never pass it to Better Auth. Never create,
  attach, or close a second pool.
- `auth-options.ts` is the single source of table-shaping choices: database
  `rate_limit` storage, the `deletionRequestedAt` and `locale` user fields,
  session settings, and `advanced.database.joins`. When you add a user field
  there, update `db/schema/auth.ts` and `db/schema/auth.test.ts` in the same
  change.
- Generate the auth tables and `customer_account_links` with Drizzle tooling
  from the checked-in schema; never hand-edit snapshots. Better Auth's own
  `migrate` command doesn't apply to this setup. Follow the migration process
  in the `deskohub-workspace-operations` skill.
- Keep `timestamptz` columns (Better Auth decodes them as `Date`) and the
  cleanup indexes on `session.expires_at`, `verification.expires_at`, and
  `rate_limit.last_request`.

## Security settings

Keep these settings unless a reviewed decision changes them:

- Sessions are stored in the database with a 30-day rolling lifetime, at most
  daily refresh, and 10-minute freshness for destructive actions. Keep cookie
  caching disabled so logout, deletion, and revocation take effect on the next
  request.
- Magic links expire after 10 minutes, are consumed atomically on first use,
  and store only a hash. Both magic-link paths allow five requests per client
  IP per 10 minutes. Database rate limiting is on in every environment because
  in-memory counters don't hold across serverless instances.
- The client IP comes only from `x-vercel-forwarded-for`.
  `trustedProxyHeaders`, `disableCSRFCheck`, `disableOriginCheck`, and
  cross-subdomain cookies stay off. Cookies are host-only, `SameSite=Lax`.
- `baseURL` is the dynamic `allowedHosts` form built by `auth-hosts.ts`: the
  canonical customer-facing host, the exact Vercel project, deployment, and
  branch hosts, and `localhost:3000` in development. Wildcards fail closed.
  Don't trust arbitrary request hosts or add a fallback host.
- Email and password sign-in is disabled. The magic-link paths return 503 while
  the accounts feature flag is off or unreadable.
- `nextCookies()` must stay the last plugin; it forwards Server Action
  `Set-Cookie` headers.
- Better Auth's logger is disabled. `onAPIError` logs only the fixed
  `account.auth.handler` code for 5xx failures and replaces the error with a
  generic 500.
- Server-side `auth.api` calls bypass the rate limiter. Send browser sign-in
  through the mounted endpoint, not a custom Server Action.

## PII minimization

- The `session.create.before` database hook stores `ipAddress` and
  `userAgent` as `null`. Keep IP detection enabled: the rate limiter needs it,
  and `disableIpTracking` would also disable rate limiting.
- Don't pass a name or image to Better Auth, so `auth.user.name` stays the
  empty string. Never fill `auth.user.image`; avatars live in Cloudinary.
- `auth.account` stays empty: the magic-link flow creates no account rows, and
  passwords, OAuth, and social providers stay disabled.
- What remains in Neon is the login email, the email inside each pending
  verification row, and raw `IP|path` rate-limit keys. Better Auth has no
  native option to hash or encrypt these, so don't build a custom adapter or
  HMAC rate-limit storage to remove them.

## Cleanup cron

Better Auth only removes expired rows when a later request happens to touch
them. The daily `auth-cleanup` cron (scheduled in `vercel.json`, authorized
with `CRON_SECRET`) deletes expired sessions and verifications, and rate-limit
rows older than the longest configured window, using plain set-based SQL. It
only cleans its own deployment's database.

## Secrets and release

- `BETTER_AUTH_SECRETS` is the versioned secret list: the first key signs new
  data and older keys still verify. Production env validation requires it,
  and auth bootstrap throws on an invalid value. Configure it per
  environment, and never derive a secret from a public deployment
  identifier. Give Preview a secret distinct from Production so session
  material copied into a preview branch can't pass as a production session.
- Pin `better-auth` and every `@better-auth/*` package to the same exact
  version, and treat published Better Auth advisories as patch triggers.
- Add only environment-scoped auth secrets and mail settings to the existing
  Vercel, Neon, Resend, and cron paths.
- Release additively: stage the build, migrate the branch, then promote. Roll
  back code without reversing account data.

## Test helpers

Better Auth's `testUtils` plugin can create users and sessions for focused
integration tests through a separate test-only auth instance. Never add it to
the runtime configuration. It doesn't replace the exact-preview magic-link
lifecycle in [magic-link delivery and account E2E](magic-link-delivery-and-e2e.md).
