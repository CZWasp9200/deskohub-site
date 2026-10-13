# Services and Layers

## Declare services

Declare the public interface first, then the service with `Context.Service` and static Layer properties. V4 has no `Effect.Service`, `Context.Tag`, or `Context.GenericTag`.

```ts
interface IFooService {
  readonly prop: Type;
}

export class FooService extends Context.Service<
  FooService,
  IFooService
>()("FooService") {
  static Default = Layer.effect(this, implementation);
}
```

Choose the Layer constructor by setup behavior:

- `Layer.effect(this, ...)` for effectful or fallible setup.
- `Layer.sync(this, ...)` for pure lazy construction.
- `Layer.succeed(this, ...)` for an existing implementation or a test fake.

Name the default implementation `Default`, even when it still requires dependencies from Context. When a standard fully wired production composition exists, expose it as static `Live` on the same class, not in a separate runtime module. This applies to every Context capability, including repositories and configuration. The `no-standalone-capability-layers` Grit rule rejects standalone `FooDefault` or `FooLive` constants.

When a runtime that can't load application environment modules must still import the capability, keep `Live` on the class and lazily load an environment-bound factory named for construction, such as `makeFooLayer`. See `accounting-snapshot-key.service.ts`.

Write service construction directly as an Effect. Add a `make*` function only when it adds behavior or reuse.

## Lay out modules

- Write a service module top-down: imports, public interface, `Context.Service` declaration, primary workflow, then progressively more concrete operations. Place new private helpers below their callers, unless a helper's inferred return type defines a public contract above.
- Split the module when a detail becomes a separate concern.
- Keep the interface, service declaration, and live Layer in `*.service.ts`. Put the mock Layer in an adjacent `*.service.mock.ts` and build partial fakes with `Layer.mock`.
- Expose a feature's public service API through explicit named exports in its `index.ts` barrel. Keep providers, repositories, and other implementation modules private. In tests, import the module under test directly, not through the barrel. The `no-wildcard-reexport` Grit rule rejects `export *` in Workspace source.

## Model capabilities

Treat services, providers, repositories, and external clients as Effect capabilities. Supply them through Context and compose them with Layers, never as function arguments or dependency objects.

- Resolve capabilities while you construct the consuming service, and close over them so public methods take domain input only.
- Let `Default` require dependencies from Context. Provide live dependencies in `Live` and swap in test Layers in tests.
- Use Effect's `HttpClient` for outbound HTTP. Provide the `FetchHttpClient` Layer at the closest adapter that owns the external call, so upstream services don't inherit the `HttpClient` requirement. In tests, provide a test client or fetch through a Layer instead of passing `fetch` as a parameter.
- Import unstable modules as namespaces from their barrel: `import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"` or `import { SqlError } from "effect/unstable/sql"`. Don't deep-import paths such as `effect/unstable/http/HttpClient`.

## Call external providers

- Bound every outbound request with a timeout that fails with the capability's typed error. Pass the `Effect.tryPromise` abort signal to promise-based SDKs so a timeout or interruption cancels the request.
- Retry idempotent reads on transient failures. A timeout, transport failure, or 5xx can follow a committed create or send, so retry writes only when the provider honors an idempotency key that stays the same across attempts. Otherwise retry only failures that prove nothing was applied, such as 429 or an empty creation response.
- When a provider rejects a cached credential with 401, invalidate the cached credential.
- Keep the original error as `cause` unless it carries request bodies, credentials, or personal data. Then strip those parts and log only tags, identifiers, status codes, and field names.

## Name and run operations

- Name public service operations with `Effect.fn("Service.operation")`. It already creates the span; add `Effect.withSpan` only for a meaningful nested boundary. Don't add a scoped annotation for the whole input when the wrapper already annotates its fields.
- Annotate the type of constructed service-boundary and public projection values. Reserve `satisfies` for configuration and other literals whose narrow inferred type you want to keep.
- `Effect.all` and `Effect.forEach` run sequentially by default. For independent items whose results you all need, use `Effect.all(items.map(operation), { concurrency: "inherit" })`. `"inherit"` is unbounded unless a caller sets `Effect.withConcurrency`. Use `Effect.forEach` for intrinsically iterative work, a numeric limit only for a real local constraint, and never fork and join fibers by hand for concurrency.
