# Database changes and releases

## Generate migrations

Generate Drizzle migrations, journals, and snapshots with Drizzle tooling. Never hand-write migration metadata or journal entries.

## Database connections

Each function instance opens at most 10 Postgres connections, as before the Effect 4.1 upgrade when one `pg.Pool` served everything:

- The Workspace's native Effect pool (`@effect/sql-pg`, built once per process with `shareAcrossRequests` in `apps/deskohub-workspace/db/database-provider.server.ts`): 8 connections for Effect SQL, Drizzle and advisory-lock sections, which take at most half of them. Better Auth's own `pg.Pool` (drizzle node-postgres): 2. They share no connection, so nothing joins a transaction across them.
- Opening a connection and waiting for a free one are bounded at 15 s. Each statement is bounded at 10 s on the client, from when it gets its connection, and fails with a retryable `StatementTimeoutError`; interrupting it sends a CancelRequest. `statement_timeout=10s` is also sent at startup, but Neon's pooled endpoint accepts and ignores it (`show statement_timeout` is 0 there), so in production only the client bound holds. BEGIN and COMMIT are not bounded on the client.
- Named prepared statements are off (`prepare: false`). Neon's pooler tracks them, but a transaction-mode pooler that doesn't fails them inside transactions, and a cached plan whose result type a migration changed fails the transaction it runs in.
- Released connections close after 5 s idle (the native pool's reaper takes up to 10 s). Both pools report each release to Vercel's `attachDatabasePool` through one emitter (`db/database-release-reporter.ts`), which keeps the instance awake 10.1 s after the last release, so idle connections close before it suspends. A connection whose backend went away while the instance was frozen is retired on its socket's close, and the next caller gets a new one.

## Release Workspace production

Every push to `main` that touches Workspace inputs deploys production, so merging is the release. `.github/workflows/deploy-workspace-production.yml` runs this sequence; keep it:

1. Build a staged Vercel production deployment without assigning domains.
2. Run pending migrations against the production Neon branch.
3. Promote the ready deployment.

After the canonical smoke check passes, the last step submits the production sitemap's canonical URLs to IndexNow with `apps/deskohub-workspace/scripts/submit-indexnow.ts`. It runs after the rollback and failure steps, with `continue-on-error`, so a failed or cancelled submission never fails or rolls back the release. A failure shows up as a `::warning` annotation on the run. The step log records only the HTTP status, host, and URL count, never the key. IndexNow verifies the key at `/<key>.txt`, which only production serves. Rotating the key means renaming the `app/<key>.txt` route folder along with `features/public-pages/indexnow-key.ts`.

Don't add database branch swapping unless the user asks for it. Don't put migrations in the Vercel build.

Old and new functions overlap during a rollout. When a schema change would break queries, mutations, constraints, or decoded data in the previous deployment, ship an expand, backfill, and compatibility release that keeps both representations in sync. Rename or drop the old representation only in a later release, after the compatibility version is fully deployed.

Skew Protection (12-hour max age from deployment creation) keeps browsers that loaded an older deployment calling its Server Actions. Don't hold a merge for it. A stale tab that hits an incompatible Server Action sees an error and retries.

Vercel queue messages stay pinned to the deployment that published them, and that older code can consume them until they're acknowledged or expire. Late-payment recovery messages are retained for seven days. Before a release that older consumers can't tolerate, check what each topic's consumer writes and whether undelivered messages from older deployments remain.

Email automation work units (`workspace-email-automation-unit`) ship consumer first. Each deployment compiles in a list of the unit kinds it can run, and it claims, promotes and reaps only those kinds. A message for an unknown kind is acknowledged without being claimed, and a deployment that supports the kind re-sends the unit. Add a kind's handler before any code plans that kind. Once automated campaigns exist, never instant-roll back past the release that added the automation schema and the unit consumer. Older code can't decode automated campaigns, shows automated sends as one-off sends, and can't run newer unit kinds.

Don't add a custom Vercel Ignored Build Step for documentation-, test-, CI-, or E2E-only changes. Rely on Vercel's automatic affected-project skipping.

## Migrate protected preview databases

The Neon/Vercel integration creates and deletes Workspace preview branches for the PR lifecycle. Keep its automatic obsolete-branch deletion on. E2E and other repository workflows must not expire or delete integration-owned branches.

`.github/workflows/workspace-e2e.yml` migrates each preview before E2E. When you change that flow, keep these properties:

- Wait for the exact immutable Git preview to report success.
- Resolve its non-primary `preview/<internal-head-ref>` branch. Fail closed when the branch-to-PR mapping is missing or ambiguous. Never fall back to production or shared development.
- Get direct and pooled URLs with pinned `neonctl`, mask both immediately, and migrate with the direct URL.

Preview reports Ready before migration runs. That's acceptable only while builds don't touch the database. A schema-breaking change must stay compatible with that order or add a preview-only migration step that runs before the runtime starts.
