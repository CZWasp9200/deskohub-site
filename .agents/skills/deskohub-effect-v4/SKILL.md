---
name: deskohub-effect-v4
description: Effect V4 service, Layer, workflow, schema, error, tagged-union handling, Workspace Effect runners, runWorkspaceEffect, runWorkspaceBrowserEffect, client-side or browser Effect runs, browser failure reporting, Effect bundle size.
---

# Deskohub Effect V4

Read only the references relevant to the change:

- For services, capabilities, Layers, module structure, mocks, tracing, barrels, tests, and the server and browser Workspace Effect runners, read [references/services-and-layers.md](references/services-and-layers.md).
- For multi-step Effect workflows and pipeline structure, read [references/declarative-workflows.md](references/declarative-workflows.md).
- For validation, schemas, brands, public types, and error mapping, read [references/schemas-errors-and-boundaries.md](references/schemas-errors-and-boundaries.md).
- For discriminated unions, `_tag` construction, and Effect Match, read [references/tagged-unions-and-match.md](references/tagged-unions-and-match.md).

For a broad service or feature refactor, read all relevant references before editing. Update the relevant reference when developer feedback changes a durable convention.

Use the repository's patched `@effect/tsgo` TypeScript installation so Effect diagnostics run in typechecks. The `multipleEffectProvide` diagnostic only covers chained `Effect.provide`; compose independent Layer dependencies with one `Layer.provide(Layer.mergeAll(...))`.
