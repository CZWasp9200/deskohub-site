import "server-only";

import {
  type AdministrationOperationError,
  type LedgerOperationName,
  type OperationConflict,
  type OperationDecodedInput,
  type OperationInProgress,
  type OperationInput,
  OperationInputInvalid,
  type OperationOutput,
  type Operations,
  OperationUnauthorized,
  type OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { type Context, Data, Effect, Schema, SchemaIssue } from "effect";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import type { AdministrationPath } from "./administration-href";

/**
 * What each operation of a group returns in-app: its contract output, or,
 * where `Richer` names the operation, a value that adds what only the Admin
 * UI reads. A richer value is still the contract output, so every API
 * adapter encodes it by the contract, which leaves the additions out.
 */
export type OperationResults<
  Ops extends Operations,
  Richer extends {
    readonly [Name in keyof Ops]?: OperationOutput<Ops[Name]>;
  } = Record<never, never>,
> = {
  readonly [Name in keyof Ops]: Name extends keyof Richer
    ? Exclude<Richer[Name], undefined>
    : OperationOutput<Ops[Name]>;
};

/**
 * One handler per operation of a group; a missing one fails the typecheck.
 * A handler may read who acts, for provenance.
 */
export type OperationHandlers<
  Ops extends Operations,
  Cause,
  R,
  Results extends OperationResults<Ops> = OperationResults<Ops>,
> = {
  readonly [Name in keyof Ops]: (
    input: OperationDecodedInput<Ops[Name]>
  ) => Effect.Effect<Results[Name], Cause, R>;
};

/** A ledger operation of the group with its decoded input. */
export type OperationLedgerRequest<Ops extends Operations> = {
  readonly [Name in LedgerOperationName<Ops>]: {
    readonly operation: Name;
    readonly input: OperationDecodedInput<Ops[Name]>;
  };
}[LedgerOperationName<Ops>];

type OperationLedgerEntry<
  Ops extends Operations,
  Name extends LedgerOperationName<Ops>,
  E,
  R,
> = Extract<OperationLedgerRequest<Ops>, { readonly operation: Name }> & {
  /** The operation, which already fails with port errors. */
  readonly apply: Effect.Effect<OperationOutput<Ops[Name]>, E, R>;
};

/**
 * Where an operation group records request IDs. Each adapter provides its
 * own: the administration API keeps them per caller's channel, and the Admin
 * UI applies directly because server actions aren't retried automatically.
 */
export interface OperationLedger<Ops extends Operations> {
  /**
   * Applies an operation at most once per caller and request ID, so a
   * retried request replays the first result instead of applying again.
   */
  readonly applyOnce: <Name extends LedgerOperationName<Ops>, E, R>(
    entry: OperationLedgerEntry<Ops, Name, E, R>
  ) => Effect.Effect<
    OperationOutput<Ops[Name]>,
    E | OperationInProgress | OperationConflict | OperationUnavailable,
    R
  >;
}

/** Applies every request, for an adapter whose caller never retries one. */
export const unscopedOperationLedger = <
  Ops extends Operations,
>(): OperationLedger<Ops> => ({
  applyOnce: ({ apply }) => apply,
});

/**
 * What a successful operation made stale. The operation group declares it;
 * each adapter applies it once the result is known.
 */
export type OperationSettlement<Input> = {
  /**
   * Starts refreshing caches the change made stale. It throws when Next.js
   * refuses, so call it from the request's own async context: the Admin UI
   * runs it after its action settles, and the administration API starts it
   * best effort with {@link startOperationSettlement}.
   */
  readonly refreshes?: (input: Input) => void;
  /**
   * The administration pages the change made stale. Every adapter
   * revalidates them in each locale: the Admin UI after its action settles,
   * the administration API best effort with {@link startOperationSettlement}.
   */
  readonly revalidates?: (input: Input) => readonly AdministrationPath[];
};

export type OperationSettlements<Ops extends Operations> = {
  readonly [Name in keyof Ops]?: OperationSettlement<
    OperationDecodedInput<Ops[Name]>
  >;
};

class OperationSettlementError extends Data.TaggedError(
  "OperationSettlementError"
)<{
  readonly cause: unknown;
}> {}

/** Runs one settlement step; a step Next.js refuses is logged and skipped. */
const settleBestEffort = (settle: () => void, refusal: string) =>
  Effect.try({
    try: settle,
    catch: (cause) => new OperationSettlementError({ cause }),
  }).pipe(
    Effect.tapError(({ cause }) => Effect.logWarning(refusal, { cause })),
    Effect.ignore
  );

/**
 * Applies a settlement from inside a fiber, for the administration API: starts
 * its refresh and revalidates its pages in each locale. Both are best effort
 * and independent: a step that Next.js refuses is logged and skipped, and
 * never changes the operation's result.
 */
export const startOperationSettlement = <Input>(
  settlement: OperationSettlement<Input>,
  input: Input
) =>
  Effect.andThen(
    settleBestEffort(
      () => settlement.refreshes?.(input),
      "Administration cache refresh could not start"
    ),
    settleBestEffort(() => {
      for (const path of settlement.revalidates?.(input) ?? []) {
        revalidateLocalizedPath(path);
      }
    }, "Administration page revalidation failed")
  );

/** One operation group's port: what every adapter calls. */
export interface AdministrationOperationPort<
  Ops extends Operations,
  R,
  Results extends OperationResults<Ops> = OperationResults<Ops>,
> {
  /**
   * Runs one operation for the current administrator: re-checks the
   * administrator grant, decodes the input strictly, applies a ledger
   * operation once through the adapter's ledger, runs the handler, and maps
   * its failure to a port error. Every adapter gets the same behaviour.
   */
  readonly invoke: <Name extends keyof Ops & string>(
    name: Name,
    input: OperationInput<Ops[Name]>
  ) => Effect.Effect<
    Results[Name],
    AdministrationOperationError,
    CurrentAdministrator | R
  >;
}

/** Why the port couldn't re-read the administrator grant. */
export type AdministratorGrantReadFailure = Effect.Error<
  ReturnType<AccountRoleGrants["Service"]["has"]>
>;

/**
 * Builds an operation group's port from its registry and handlers. The
 * group's `toOperationError` maps each domain failure to its port category
 * with a stable code, and passes port errors through unchanged.
 */
export const makeAdministrationOperationPort = <
  Ops extends Operations,
  Cause,
  R,
  Ledger,
  Results extends OperationResults<Ops> = OperationResults<Ops>,
>({
  group,
  operations,
  handlers,
  ledger,
  toOperationError,
}: {
  /** Names the port's spans, as `<group>.invoke`. */
  readonly group: string;
  readonly operations: Ops;
  readonly handlers: OperationHandlers<Ops, Cause, R, Results>;
  /** The adapter's ledger for the group's ledger operations. */
  readonly ledger: Context.Key<Ledger, OperationLedger<Ops>>;
  readonly toOperationError: (
    cause:
      | NoInfer<Cause>
      | AdministratorGrantReadFailure
      | AdministrationOperationError
  ) => AdministrationOperationError;
}) =>
  Effect.gen(function* () {
    const grants = yield* AccountRoleGrants;

    const authorize = CurrentAdministrator.pipe(
      Effect.flatMap(({ accountId }) =>
        grants.has({ accountId, role: "administrator" })
      ),
      Effect.mapError(toOperationError),
      Effect.filterOrFail(
        (isAdministrator) => isAdministrator,
        () =>
          new OperationUnauthorized({
            code: "administrator-required",
            message:
              "Your account isn't an administrator any more. Ask an administrator to grant the role again.",
          })
      )
    );

    const invoke = <Name extends keyof Ops & string>(
      name: Name,
      input: OperationInput<Ops[Name]>
    ) => {
      const operation: Ops[Name] = operations[name];
      const handle: OperationHandlers<Ops, Cause, R, Results>[Name] =
        handlers[name];
      return authorize.pipe(
        Effect.andThen(
          // An operation's input schema decodes without services.
          decodeOperationInput(
            operation.input as Schema.Decoder<OperationDecodedInput<Ops[Name]>>,
            input
          )
        ),
        Effect.flatMap((decoded) => {
          const applied = handle(decoded).pipe(
            Effect.mapError(toOperationError)
          );
          return operation.ledger
            ? Effect.flatMap(
                ledger,
                (requests) =>
                  // The registry pairs a ledger operation's name with its
                  // input, which a generic name can't express.
                  requests.applyOnce({
                    operation: name,
                    input: decoded,
                    apply: applied,
                  } as never) as typeof applied
              )
            : applied;
        }),
        Effect.mapError(toOperationError),
        Effect.withSpan(`${group}.invoke`, {
          attributes: { operation: name },
        })
      ) as Effect.Effect<
        Results[Name],
        AdministrationOperationError,
        CurrentAdministrator | R | Ledger
      >;
    };

    return { invoke } satisfies AdministrationOperationPort<
      Ops,
      R | Ledger,
      Results
    >;
  });

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** Unknown keys and invalid values fail as one `input-invalid` error. */
const decodeOperationInput = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: S["Encoded"]
): Effect.Effect<S["Type"], OperationInputInvalid> =>
  Schema.decodeUnknownEffect(schema)(input, strictParseOptions).pipe(
    Effect.mapError(
      (cause) =>
        new OperationInputInvalid({
          code: "input-invalid",
          message: `The input is invalid: ${cause.message}`,
          issues: formatIssues(cause.issue).issues.map(({ path, message }) => ({
            path: (path ?? []).map((segment) => String(segment)),
            message,
          })),
          cause,
        })
    )
  );
