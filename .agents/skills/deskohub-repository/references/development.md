# Repository development

## Toolchain

- Use Bun from the repository's pinned version. Bun is pinned to 1.4.2: empirically verified that 1.3.14 misresolves the official `@typescript/typescript6` wrapper's internal `@typescript/old` alias into the root alias (self-referential lock record), while the released 1.4.0 binary resolves it correctly (reproducible two-binary install matrix); do not downgrade the pin and only regenerate bun.lock with ≥1.4.0 (an existing lock keeps a bad record even across `bun install --force`).
- Run workspace orchestration through Turborepo from the repository root when task dependencies or generated outputs matter.
- Declare task dependencies with Turbo `dependsOn`. Keep package scripts as leaf commands; compose lint checks and generation prerequisites in the Turbo graph rather than shell chains or script-to-script calls.
- Every package containing checked-in source must expose a lint task so the root lint graph covers it.
- When a package `turbo.json` overrides `dependsOn` for a root task that depends on `^<task>`, start the list with `$TURBO_EXTENDS$`. Turbo hashes only a package's own files, so dropping the `^` dependency lets internal-package changes replay a stale cached result.
- Declare files outside a package that a task reads, such as root scripts and patches, as `$TURBO_ROOT$/...` inputs. Never make a cached or validation task depend on an uncached task that fetches live remote data and rewrites tracked files.
- Inspect the target package's `package.json` before assuming it exposes a command.

### TypeScript toolchain

- `@typescript/native` (`npm:typescript@7.0.2`) provides the `tsc` CLI; the root `prepare` script patches it to `7.0.2+effect-tsgo.0.36.4` via effect-tsgo.
- `typescript` (`npm:@typescript/typescript6@6.0.2`) provides the TS6 API (`createProgram`) consumed by typescript-eslint and Next.js, exposed as the `tsc6` CLI.
- Never add plain `typescript@5`/`6`/`7` dependencies or new `tsc`-bin-providing packages.
- Next apps set `experimental.useTypeScriptCli: false` because Next's CLI integration resolves `bin.tsc`, which the official TS6 wrapper (tsc6-only) must not provide; with the flag off, Next type-checks builds through its TS6 API worker (no CLI), while `bun turbo typecheck` separately runs the patched native compiler.
- Workspace test files (`**/*.test.ts`, `**/*.test.tsx`) are intentionally not typechecked. `apps/deskohub-workspace/tsconfig.json` excludes them, its `typecheck` task checks only that project, and Bun runs tests without type checking. There is no test tsconfig in the check graph. Do not report this as an audit finding, and do not add a test tsconfig, test typecheck task, or Turbo dependency for it. Shared packages and `dhw` use a single tsconfig whose `include` happens to cover their colocated tests; leave that as it is unless the developer decides otherwise.

### Next.js

- Upgrade `next` and every `@next/*` package together: the Workspace and Boardgame Bar tilde ranges, the exact `@next/playwright` pin, and the `next` peer ranges in `packages/i18n` and `packages/next-effect`. Regenerate `bun.lock` with one `bun install`, then confirm `bun install --frozen-lockfile`.
- Strict route matching is on by default from 16.4. Do not opt out with `deprecated.looseRouteMatching`. Every parallel-route slot page must belong to a complete route, so each sibling slot under that layout needs a matching page or `default.tsx` for the URL. A slot catch-all counts only when it combines with real sibling `children` routes. `next build` fails on violations, while `next dev` shows an error overlay that blocks browser fixtures. Fixtures that copy part of the route tree must keep it complete: for example, `e2e/account-legal-fixture.ts` copies the account `@modal` slot's `page.tsx` and `default.tsx` along with the account routes.
- Do not assert raw RSC flight rows. The row format changes between minors: 16.4 moves a client reference's module id and export name into separate string rows that the import row references. Parse the rows and resolve the references.

## Bootstrap and development

Install dependencies from the repository root:

```bash
bun install
```

Run an application through its package name:

```bash
bun turbo dev --filter=<package-name>
```

The Next.js applications use the same default development port. Set `PORT` when running them together. The portal uses its own Astro development address.

## Patched dependencies

`@effect/sql-pg` is pinned through `patchedDependencies` in the root `package.json` (`patches/@effect%2Fsql-pg@4.0.0-beta.85.patch`). The patch eliminates pooled `pg_cancel_backend` entirely: an interrupted statement, or one that fails without a server SQLSTATE code (for example pg's `Query read timeout`), destroys its connection lease, so the pool removes and ends the connection, the backend terminates by session teardown (bounded by `statement_timeout`), and the connection can never be handed to another fiber or leak an open transaction. Server-classified SQLSTATE failures keep the connection. The `Database pool cancellation against real Postgres` seam in `apps/deskohub-workspace/db/database-pool-cancellation.test.ts` guards the behavior against a production-style external pool with `query_timeout` shorter than `statement_timeout`; rerun it (and re-apply or drop the patch) whenever `@effect/sql-pg` is upgraded, since a version change invalidates the patch key.

`effect` is patched the same way (`patches/effect@4.0.0-beta.85.patch`) so a fiber resumed by a callback continues in the async context it suspended in, as an awaited promise does. Unpatched, the callback's own context leaks into the fiber: a pg query callback fires from the socket of whichever request opened the pooled connection, and a semaphore release, shared layer build or `Deferred` completion fires from the request that finished it. Next.js request APIs (`revalidatePath`, `revalidateTag`, `after`, `headers`, `cookies`) then target that other request; one symptom was `revalidatePath` failing "during render" for an unrelated page after an admin action's database write. Keep request APIs inside Effects; no per-call-site workaround is needed. The `request async context` tests in `packages/next-effect/src/index.test.ts` and `apps/deskohub-workspace/db/database-async-context.test.ts` fail without the patch; rerun them and re-apply the patch whenever `effect` is upgraded.

## Branch integration

Before delegating a merge, inspect each conflict and decide the exact combined behavior. Assign each worker one file or tightly coupled production-and-test pair, the prescribed resolution, and one focused check. Keep lockfile reconciliation and generated-file cleanup separate. Verify the combined result and request its review; a worker assignment is not "integrate main" or "resolve all conflicts".

## Checks

Prefer focused checks first, then the affected application or package suite:

```bash
bun turbo lint --filter=<package-name>
bun turbo typecheck --filter=<package-name>
bun turbo test --filter=<package-name>
bun turbo build --filter=<package-name>
```

Workspace `lint` includes `lint:knip`, the full Knip analysis of `apps/deskohub-workspace` (unused files, exports, types, duplicate exports, unresolved imports, and dependencies) configured in the root `knip.jsonc`. It depends on `i18n:compile` because Paraglide output is generated, and configuration hints fail the check. Remove a flagged export, or drop its `export` keyword when the file still uses it, rather than ignoring the finding. Register a module that is loaded by path rather than imported as a commented Workspace `entry`.

Workspace has additional database and E2E tasks. Read the Workspace operations or E2E skill before running them against any shared or hosted environment.

## Test placement

- Test behaviour at the cheapest layer that has the infrastructure it needs. Put CSS, animation, layout, and focus facts in component tests or real-browser component tests (`shared/testing/playwright-browser.ts`), not E2E. Keep E2E for cross-page flows, auth, persistence, payments, integrations, and deployment behaviour.
- No tautological tests: do not re-assert source text, constants, config literals, mock return values, or your own fixtures.
- Convention and import-boundary guards are lint rules, not tests. Use a `noRestrictedImports` override in the root `biome.json` or a Grit plugin under `lint/`, and add rejecting and permitting cases to `shared/testing/lint-rules.test.ts`, which lints its whole corpus in one Biome run with the repository plugins and overrides. Biome replaces a rule's options across matching overrides instead of merging them, so keep `noRestrictedImports` scopes disjoint and use Grit for an overlapping file set. `noRestrictedImports` also reports dynamic `import()`; use Grit when only static imports are banned. A guard Grit cannot express precisely, such as the AST-based email-literal ban in `@deskohub/test-email`, is a `*.test.ts` in the package that owns the convention, never a standalone script; give that package's `test` task turbo `inputs` covering every path it scans.
- Real-clock waits (retry backoff, sleeps, delays) use Effect `TestClock`, injected zero-delay schedules, or fake timers. In Workspace, `withInstantSleeps` (`shared/testing/workspace-test-clock.test-utils.ts`) steps a TestClock until the effect finishes. To prove a concurrent Postgres waiter exists, poll `pg_locks` with `waitForAdvisoryLockWaiter` or `waitForPostgresLockWaiter` (`shared/testing/workspace-postgres-lock-waiters.test-utils.ts`) instead of sleeping.
- Test SQL behaviour against Postgres (`*.postgres.test.ts`), not SQL text.

## Test email addresses

Tests, fixtures, E2E code, and visual scripts never write an email address. Build test recipients with `testEmailAddress(localPart)` from `@deskohub/test-email`, which uses the `EMAIL_TEST_DOMAIN` code constant (`deskohub.test`), so mail goes to the Console provider. Use `resendSimulatorAddress(outcome)` only when a test needs a real Resend destination. `@deskohub/test-email` has no dependencies; a package whose tests need an address takes it as a devDependency instead of depending on `@deskohub/email`, which owns only the routing (`isTestEmailRecipient`). The same package enforces the rule: `src/repository-test-email-literals.test.ts` runs the AST scanner in `src/test-email-literals.ts` over test, fixture, E2E, and visual-script modules across `apps/`, `packages/`, and `scripts/`, except Boardgame Bar, which keeps its own email setup, and fails with `path:line:column address` for each offender. The scanner folds `+` chains of literals (parentheses included), decodes escaped, entity-encoded, and URL-encoded `@`, and checks each address token separately; its header lists what is deliberately allowed. Its cases live in `src/test-email-literals.test.ts`. The package's `turbo.json` gives its `test` task `$TURBO_ROOT$` inputs for every scanned root and extension, so editing any scanned module invalidates the cached result; a case in `src/test-email-literals.test.ts` keeps those inputs aligned with the scanner. Workspace depends on the package, so Workspace CI's `turbo test` runs it through `^test`.

## Environment files

Each application owns its `.env.example`. Copy it to the app-local ignored environment file and keep developer-only values in app-local ignored overrides.

Keep Vercel-synced values in the matching ignored `.env.<environment>.local` file rather than the generic `.env.local`.

Never commit real environment files or print credential values. Read the Workspace operations skill before using production integration access.

## Generated assets

- Compile an application's localized messages after changing its message JSON and before trusting generated copy or copy-sensitive tests: `bun turbo i18n:compile --filter=<package-name>`.
- Regenerate Dotypos and Nexi clients from their checked-in OpenAPI contracts rather than editing generated files.
- The Games and Igloohome clients are gitignored; their package `turbo.json` makes `test` and `typecheck` depend on the cached `generate` task. Run their tests through `bun turbo test --filter=<package-name>`, or run the package's `bun run generate` once before a bare `bun test`.
- Generate Workspace database migrations and metadata with Drizzle tooling. Never hand-write its journal or snapshots.

## Workspace build-cache boundary

The Workspace `build` hash must retain Vercel's deployment-specific `NEXT_PUBLIC_VERCEL_*` inputs. They carry the version information required by Skew Protection, so a cache miss between deployments is expected. Do not exclude those variables from `build` to force a full Next.js cache hit.

The independent `i18n:compile` task may exclude `NEXT_PUBLIC_VERCEL_*` because its declared inputs are only the message files and Inlang configuration. This lets unchanged generated messages come from the remote cache without weakening the deployment-specific application build. Keep this distinction when editing `apps/deskohub-workspace/turbo.json`.

## CI boundaries

- Monitor an active GitHub run with `timeout <seconds> gh run watch <run-id> --exit-status --interval <seconds>`. Use `gh run view` for a one-time status inspection, not a `sleep`-then-inspect polling loop. A local watch timeout does not cancel the remote workflow.
- Workspace tests cover changes to Workspace, shared packages, and root build inputs.
- Boardgame Bar tests run in their own `.github/workflows/boardgame-bar-ci.yml` PR workflow, path-filtered to Bar, shared packages, and root build inputs, through `bun turbo test --filter=deskohub-boardgame-bar`; its `test` task depends on the generated Paraglide runtime and API clients, as `typecheck` does.
- Workspace CI runs four native Bun test shards, each with its own disposable Postgres service; keep the test task at `--parallel=1` because suites mutate process-wide state. Database-backed suites skip when `WORKSPACE_TEST_DATABASE_URL` is unset, so the shard job sets it in job-level `env` and its first step fails the shard when the value is missing or empty; keep the value where that step can see it.
- Bun splits those shards by the per-file durations in the committed `apps/deskohub-workspace/test-timings.json` (`--timings`); without it, Bun deals files round-robin by path. Bun 1.4 cuts the path-sorted files into contiguous ranges at equal cumulative-duration marks rather than packing them, so one slow file, or slow files adjacent by path, bound the balance: split slow test files instead of adding shards. Bun gives unlisted files a guessed duration, so many unrecorded files skew the split. Each passing shard records its files' wall times with `--update-timings` and uploads them as the `workspace-test-timings-shard-<n>` artifact. After adding, renaming, splitting, or substantially slowing test files, refresh the file from a Workspace CI run of the checked-out commit where every shard passed: `bun apps/deskohub-workspace/scripts/refresh-test-timings.ts <run-id>`, then commit it. The script rejects a run missing any local test file and prints predicted shard totals. Do not refresh from local runs; they measure a different machine.
- Workspace code runs subprocesses only through `runCommand` or `commandOutput` in `apps/deskohub-workspace/scripts/shared/command.ts`; the `no-synchronous-subprocess` Grit rule rejects `Bun.spawnSync` and the `node:child_process` `*Sync` calls. In Bun 1.4.2 a garbage collection inside a synchronous spawn can finalize an earlier test file's stdio writer against the spawn's isolated event loop and permanently lower its poll count. Every later synchronous spawn in that worker then spins until the test times out, printing `killed 1 dangling process` (oven-sh/bun#43697). Async spawns are unaffected. Settle a subprocess promise before asserting on it rather than using `expect(pending).rejects` or `.resolves`, because those matchers run a nested event-loop tick that can drop a child's pipe events. Re-evaluate the rule after upgrading to a Bun release that includes oven-sh/bun#44581. Preserve `test-functional` as the fail-closed required check over all test shards, Workspace validation, and migration-count validation.
- Gate Bun browser tests with `test.skipIf(!(await playwrightChromiumAvailable()))` from `shared/testing/playwright-browser.ts`: it skips locally when Playwright Chromium is missing but throws when `CI` is set, so a shard never silently drops browser coverage. Keep each heavy browser suite in its own file so the duration-balanced shards can spread it, and move shared setup into a `*.test-utils.ts` or `*-fixture.ts` module (for example `e2e/account-legal-fixture.ts`, which gives each file its own fixture server port).
- Tests must not reach real network services. Child-process script tests stub HTTP with a `--preload` fixture that replaces `fetch`, as `scripts/production-release.vercel-api-fixture.ts` does for the Vercel API, and assert the child's exit code instead of relying on a `timeout` wrapper.
- The `no-useless-alias` Grit rule rejects `const alias = source` when `source` is an import, `const`, function, or class binding. Use the original name, or rename at the boundary with `import { source as alias }` / `export { source as alias }` (route handlers export `{ handler as GET }`) when the new name carries meaning. GritQL cannot resolve scopes, so the rule skips any source name that the file also binds as a `let`/`var`, parameter, or catch binding, rebinds in a scope that does not enclose the alias (block, function, named class or function expression, namespace), or reuses as an enum member (quoted, `$`-prefixed, and computed `["name"]` member names included, comments ignored; any escaped enum member name suppresses the whole file); it also skips sources whose declaration mentions `Symbol` or `unique` and aliases read through `typeof`, because the alias widens a unique symbol type; a type annotation (`const alias: T = source`) keeps an intentional widening alias.
- Grit plugins dominate Workspace `lint:biome` CPU: Biome walks every Workspace file once per plugin, and per-node regex and snippet matching is expensive. Open each plugin's `file($name, $body)` clause with whole-file text prefilters (`$body <: r"(?s).*\btoken\b.*"`) on tokens that every reportable match must contain, and guard expensive per-match scans with a file-level `contains` of a necessary precondition, as `no-widen-then-assert` does. A prefilter must follow from the rule's own patterns and never narrow them. Prove a plugin edit with `scripts/anti-slop.test.ts`, `shared/testing/lint-rules.test.ts`, and an identical old/new diagnostic set on the repository and on an uncommitted violating corpus. Profile one plugin by running the Workspace `biome check` with only that plugin in `plugins` and comparing user CPU time against an empty list. Kind-gating snippets and name-gating `TsReferenceType` gave no measurable gain.
- Workspace E2E starts from the successful immutable protected preview for the exact commit.
- The `dhw` CLI and its shared administration contract have a release-producing commit requirement. Read the Workspace administration reference before changing that boundary.
- Preview database lifecycle is owned by the hosting integration. Repository workflows do not delete those branches.
- Pin every third-party action to a full commit SHA (not an annotated tag object) with a `# vX.Y.Z` comment. Set `persist-credentials: false` on checkouts that never push. Give each secret, and each GitHub App token's `permission-*` inputs, to the narrowest step or job that uses it. Pass `${{ }}` values to `run:` scripts through `env:`.
