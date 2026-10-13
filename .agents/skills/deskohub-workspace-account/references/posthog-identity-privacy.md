# PostHog identity and privacy

Code: `features/account/analytics-identity.ts`,
`features/cookie-consent/components/posthog-analytics.tsx`, and
`features/cookie-consent/utils/` (`posthog-config.ts`, `posthog-identity.ts`).

## Account identity contract

- The account analytics boundary publishes only `pending`, `unavailable`,
  `anonymous`, or `authenticated`, plus the opaque `CustomerAccountId` when
  authenticated. Better Auth session and user details stay private.
- The app has one root `PostHogProvider` (`app/[locale]/layout.tsx`).
  Initialize PostHog only after analytics consent.
- Derive the distinct ID with `getPostHogAccountDistinctId`, and call
  `identify(id)` without properties. A consented anonymous browser history may
  merge into the account at that call.

## Identity transitions

- Reset the previous identity before opting in capture for a different account,
  and after confirmed logout, account deletion, or session expiry. Reset before
  opting out when consent is withdrawn.
- Pause analytics while auth is `pending` or `unavailable`, and don't repeat
  resets while authority is uncertain. A failed logout refreshes authority and
  doesn't reset early.
- Callers use `beginAnalyticsAccountTransition`,
  `completeAnalyticsAccountSignOut`, and `refreshAnalyticsAccountIdentity`.
  A plain refresh keeps an unresolved mutation barrier, so focus refreshes and
  `SessionRefresh` can't resume analytics mid-mutation. A failed logout or
  deletion, or a completed outcome that didn't delete the account, calls
  `refreshAnalyticsAccountIdentity({ settleTransition: true })`. Confirmed
  success calls `completeAnalyticsAccountSignOut`.
- Refresh authoritative session state on mount, focus or visibility recovery,
  and cross-tab auth signals. Publish `pending` during the refresh and
  `unavailable` after an authority failure.
- Settled identity changes (login, account switch, expiry) and confirmed
  termination emit a same-origin notification; a same-account refresh
  doesn't. The account and consent `localStorage` signals carry only random
  nonces, never IDs, profile data, payloads, or timestamps. A consent
  withdrawal in another tab stops the SDK at once; reconsent verifies fresh
  auth before enabling it.
- better-auth's `useSession` `refetch` resolves even when the request fails and
  records the failure on the atom's `error`. Report
  `account.analytics-session.refresh-failed` for both a rejected refetch and
  one that resolves with an error.

## Event and property limits

- Keep session replay, autocapture, exception capture, heatmaps, and surveys
  disabled so profile, billing, and PIN values never enter PostHog.
- Redact URL query strings, hashes, credentials, and operational path
  identifiers. Apply the URL cleanup to current, initial, and
  `$session_entry_*` variants, including session-entry campaign fields;
  disabled replay doesn't suppress session metadata. Drop malformed metadata,
  and remove saved UTM and click metadata.
- Don't describe network IP handling as disabled.
- Person properties never include email, name, phone, billing, reservation
  IDs, or raw auth data. Don't alias a browser to a reservation or send a
  Dotypos customer ID.
- Server events set `$process_person_profile: false` and may keep the
  reservation and payment operational IDs that existing durable metrics need.
  Consented request events use the browser's `distinct_id` and `$session_id`.
  Webhooks can't join a browser without an approved persisted consent link.
- Browser failure reports (`reportWorkspaceBrowserFailure`) reach PostHog Logs
  through `posthog.captureLog` only while analytics is ready (consented, with
  a settled identity). `captureLog` bypasses `before_send`, so the sink
  overrides `url.full` with the sanitized page URL and adds
  `deployment.environment.name`. A record holds only the operation, boundary,
  failure code, an allowlisted error type (else `unclassified`), and an HTTP
  status.
- Records reported while analytics is paused wait in an in-memory outbox of 50
  and go out once analytics is ready, under whichever distinct ID is ready
  then. Every reconcile without consent or with an unsafe telemetry host
  discards them. They don't survive a page load.

## Flag-request gotcha

The SDK's `/flags` request bypasses `before_send` and merges persisted
`$initial_person_info`, `$initial_referrer_info`, and
`$initial_campaign_params`, even with the `save_*` options off. Right after
`init`, and again before re-enabling or reloading flags, call `unregister`
for exactly those three keys. This keeps the `distinct_id` and history and
doesn't touch remote data.

## Ingest host isolation

Better Auth cookies are host-only, and the SDK has no option to omit
credentials (`fetch` uses same-origin credentials and Beacon may send them).
`isPostHogTelemetryHostAllowed` fails closed before SDK init when the ingest
hostname matches the app hostname (on any port), or the ingest URL is
relative, same-origin, non-HTTP(S), or has userinfo. Keep the public UI
working instead of throwing, and never fall back to a same-host proxy.

## Not part of this integration

- No auth or user database connector, warehouse sync, connector credentials,
  or bulk export. A default Postgres sync would export auth PII and secrets. A
  future export needs an approved purpose, property list, retention rule, and
  root policy first.
- Don't enable `ensure_experience_continuity`, change `person_profiles` from
  `identified_only`, or add device bucketing without a root decision.
  Changing the distinct ID can move a percentage-rollout bucket, so keep
  account rollouts global on or off.

## Retention

PostHog `reset` changes only local identity state; it doesn't delete remote
events or unmerge aliases. Public legal copy uses generic provider-settings
language for analytics retention; don't promise deletion deadlines. How
PostHog erasure requests are handled is the project owner's decision and must
not block account deletion. Better Auth retention is in
[privacy and retention](privacy-and-retention.md).

## Verification

From `apps/deskohub-workspace`, run `bun scripts/posthog-identity-browser.ts`.
It uses a local fake ingest and synthetic identities, and fails unless the
installed SDK and every event's `$lib_version` match the pinned `posthog-js`
version. CI doesn't run it, so `scripts/posthog-sdk-version.test.ts` keeps the
pin exact. Run the browser script on every SDK upgrade and check flag,
remote-configuration, capture, and replay payloads.
