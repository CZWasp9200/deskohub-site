# Workspace feature-flag architecture

PostHog is the source of truth for Workspace flag keys, variants, and payload types. Workspace owns a checked-in generated contract so normal builds do not need the management API or its credential.

## Synchronize the contract

After changing flags in PostHog, run:

```bash
bun turbo run feature-flags:sync --filter=deskohub-workspace
```

Generation writes only definitions and payload shapes, never live payload values. It uses the same `POSTHOG_API_KEY` as the application; supply that credential explicitly when running the synchronization command.

## Runtime evaluation

Server features resolve the app-owned feature-flag Context capability. That boundary owns the process-scoped typed Node client. It reads the live management definition through the cached runtime management configuration and proves whether boolean enablement is constant. Inactive flags, unconditional 0% flags, and unconditional 100% flags are constant; partial rollouts, person/group/cohort/dependent conditions, continuity, and unknown definitions require the request subject. A management read failure also requires the request subject.

Boolean lookups return a proven constant directly, without reading request state or asking PostHog to evaluate it. Whole-snapshot evaluation likewise returns proven constants locally when every requested flag is constant. The Node SDK swallows failed, timed-out, or quota-limited remote evaluations and returns an empty snapshot, so a needless remote call turns transient PostHog failures into missing flags. Request-dependent evaluation uses the consented PostHog visitor identity, falling back to the fixed subject before consent.

Public pages use this adaptive capability through one rendering path. Cache request-independent provider reads, such as public calendar or media data, at their own boundaries. Do not cache a parallel global version of the page or duplicate service layers for global and request evaluation: when a flag becomes targeted, the same capability reads the request subject and Next.js makes that route dynamic.

React consumers use the generated typed hook under the single provider at the localized application root. Do not add feature-local providers or independently declared flag-key types.

## Deployment-scoped overrides

The optional server-only override map must be a JSON object of boolean values; malformed JSON and non-boolean values fail environment validation in every deployment. Production rejects any non-empty map, so an unknown key still fails there.

Outside production, the server PostHog configuration resolves the validated map against the generated contract and drops unknown keys with a warning that names only the keys, never values. One Vercel Preview value serves every branch, and it may name a flag that exists in PostHog before a branch has synchronized its contract. Failing on that key would break every preview build that has not synchronized yet. Builds do not regenerate the contract. Consumers read the resolved map from the server PostHog configuration, never the raw environment value.

Only development and protected preview may configure a non-empty map. Production must reject it. Apply one immutable map to the process-scoped server client and serialize that same map to the consent-aware browser boundary. Never derive or mutate overrides from requests, cookies, URLs, headers, or visitor identity.

After browser analytics initializes, replace the complete override set. Explicitly clear persisted overrides when configuration is absent. Do not initialize analytics merely to apply an override before consent.

Overrides are isolated validation tools, not rollout management, and never mutate the definitions stored by PostHog.

## Rollout inspection

Read a flag's enabled status independently from its release conditions. A disabled flag may still display the conditions that would apply if enabled; that configuration is not evidence that the flag is active.
