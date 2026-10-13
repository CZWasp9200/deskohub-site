# Dotypos manual API inspection

Inspect Dotypos data through `DotyposService` with `bun --eval`, not throwaway scripts in the repository. The service handles token exchange, bearer auth, timeouts, retries, and error mapping.

- Use production Dotypos access only when the developer explicitly asks for it.
- Never print env values. `DOTYPOS_REFRESH_TOKEN` and `DOTYPOS_CLIENT_SECRET` are secrets, and Vercel Preview env pulls don't provide the refresh token.
- Bun loads `.env*` files from the working directory even without `--env-file`, so any run from `apps/deskohub-workspace` reaches the configured Dotypos account.
- Print only the fields you need. Customer records hold personal data.

Run from `apps/deskohub-workspace`. This example lists tables. The config decode error and provider errors can carry the raw input, including the secrets, so `Effect.matchCause` reduces every failure to its `_tag` before anything reaches the terminal. Keep that projection when you adapt the snippet:

```bash
bun --env-file=.env.development --env-file=.env.local --env-file=.env.development.local --eval '
import { Cause, Effect, Layer, Option, Schema } from "effect";
import { DotyposRuntimeConfig, DotyposRuntimeConfigSchema, DotyposService, dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos";
const config = Layer.effect(DotyposRuntimeConfig, Schema.decodeUnknownEffect(DotyposRuntimeConfigSchema)({
  clientId: process.env.DOTYPOS_CLIENT_ID, clientSecret: process.env.DOTYPOS_CLIENT_SECRET,
  refreshToken: process.env.DOTYPOS_REFRESH_TOKEN, cloudId: process.env.DOTYPOS_CLOUD_ID,
  branchId: process.env.DOTYPOS_BRANCH_ID, employeeId: process.env.DOTYPOS_EMPLOYEE_ID,
  apiUrl: process.env.DOTYPOS_API_URL, apiTimeout: dotyposApiTimeoutDefaultMilliseconds, reservationTableIds: [],
}));
const result = await Effect.runPromise(DotyposService.use((dotypos) => dotypos.getTables()).pipe(
  Effect.provide(DotyposService.Live.pipe(Layer.provide(config))),
  Effect.matchCause({
    onFailure: (cause) => ({ failed: Option.match(Cause.findErrorOption(cause), { onNone: () => "defect or interruption", onSome: (error) => error._tag }) }),
    onSuccess: (tables) => tables.map(({ id, name, seats, enabled }) => ({ id, name, seats, enabled })),
  })));
console.log(result);
'
```

A `SchemaError` means a `DOTYPOS_*` variable is missing or malformed. Check which variables are set by name only; don't print their values.
