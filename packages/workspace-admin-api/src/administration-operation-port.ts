import { Schema } from "effect";
import type { DhwVersion } from "./dhw-version";
import { CliMutationRequestId } from "./workspace-admin-api";

/*
 * The administration operation port's contract, shared by every operation
 * group: how a group declares its operations, and the failure categories
 * with stable codes that every adapter maps to its own errors.
 */

/**
 * One operation of an administration operation group: its input and output
 * schemas, whether it only reads, whether a retried request replays its first
 * result (`ledger`; the adapter's ledger knows the request ID), and the oldest
 * `dhw` that may call it.
 */
export interface OperationDefinition<
  Input extends Schema.Top = Schema.Top,
  Output extends Schema.Top = Schema.Top,
  Ledger extends boolean = boolean,
  Kind extends OperationKind = OperationKind,
> {
  readonly kind: Kind;
  readonly input: Input;
  readonly output: Output;
  readonly ledger: Ledger;
  readonly minimumDhwVersion: DhwVersion | undefined;
}

/** A query only reads; a mutation writes. */
export type OperationKind = "query" | "mutation";

/** A registered operation; it also knows its own name. */
export interface Operation<
  Name extends string = string,
  Input extends Schema.Top = Schema.Top,
  Output extends Schema.Top = Schema.Top,
  Ledger extends boolean = boolean,
  Kind extends OperationKind = OperationKind,
> extends OperationDefinition<Input, Output, Ledger, Kind> {
  readonly name: Name;
}

export type Operations = {
  readonly [name: string]: Operation;
};

type OperationOptions<Input extends Schema.Top, Output extends Schema.Top> = {
  readonly input: Input;
  readonly output: Output;
  readonly minimumDhwVersion?: DhwVersion;
};

/** A read without side effects. */
export const query = <Input extends Schema.Top, Output extends Schema.Top>({
  input,
  output,
  minimumDhwVersion,
}: OperationOptions<Input, Output>): OperationDefinition<
  Input,
  Output,
  false,
  "query"
> => ({
  kind: "query",
  input,
  output,
  ledger: false,
  minimumDhwVersion,
});

/**
 * A write. With `ledger`, a retried request replays the first one's result;
 * the request ID is in the input or the adapter's request.
 */
export function mutation<Input extends Schema.Top, Output extends Schema.Top>(
  options: OperationOptions<Input, Output> & { readonly ledger: true }
): OperationDefinition<Input, Output, true, "mutation">;
export function mutation<Input extends Schema.Top, Output extends Schema.Top>(
  options: OperationOptions<Input, Output>
): OperationDefinition<Input, Output, false, "mutation">;
export function mutation<Input extends Schema.Top, Output extends Schema.Top>({
  input,
  output,
  ledger = false,
  minimumDhwVersion,
}: OperationOptions<Input, Output> & {
  readonly ledger?: boolean;
}): OperationDefinition<Input, Output, boolean, "mutation"> {
  return { kind: "mutation", input, output, ledger, minimumDhwVersion };
}

/** Names each definition after its key. */
export const defineOperations = <
  const Definitions extends Record<string, OperationDefinition>,
>(
  definitions: Definitions
): {
  readonly [Name in keyof Definitions & string]: Operation<
    Name,
    Definitions[Name]["input"],
    Definitions[Name]["output"],
    Definitions[Name]["ledger"],
    Definitions[Name]["kind"]
  >;
} =>
  Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      { ...definition, name },
    ])
  ) as never;

/** What an adapter passes in: the encoded input, decoded by the port. */
export type OperationInput<Op extends Operation> = Op["input"]["Encoded"];
/** What the port's handler receives after decoding. */
export type OperationDecodedInput<Op extends Operation> = Op["input"]["Type"];
export type OperationOutput<Op extends Operation> = Op["output"]["Type"];

/** Names of the operations whose retried requests replay the first result. */
export type LedgerOperationName<Ops extends Operations> = {
  readonly [Name in keyof Ops]: Ops[Name]["ledger"] extends true ? Name : never;
}[keyof Ops];

/** Where in the input a problem is, and what is wrong there. */
export const OperationInputIssue = Schema.Struct({
  path: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
  message: Schema.String,
});
export type OperationInputIssue = typeof OperationInputIssue.Type;

/**
 * The port's failures. `code` is a stable kebab-case id the Admin UI
 * localizes; `message` is English, actionable, and never holds customer
 * data. `cause` keeps the domain error for logs.
 */
const operationErrorFields = {
  code: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
};

/** The input can't be accepted as given. */
export class OperationInputInvalid extends Schema.TaggedErrorClass<OperationInputInvalid>()(
  "OperationInputInvalid",
  {
    ...operationErrorFields,
    issues: Schema.optionalKey(Schema.Array(OperationInputIssue)),
  }
) {}

/** The current state refuses the operation. */
export class OperationConflict extends Schema.TaggedErrorClass<OperationConflict>()(
  "OperationConflict",
  operationErrorFields
) {}

export class OperationNotFound extends Schema.TaggedErrorClass<OperationNotFound>()(
  "OperationNotFound",
  operationErrorFields
) {}

/** A dependency is unavailable; retrying later can succeed. */
export class OperationUnavailable extends Schema.TaggedErrorClass<OperationUnavailable>()(
  "OperationUnavailable",
  operationErrorFields
) {}

/**
 * The caller isn't an administrator any more: the port re-reads the grant
 * on every operation, after the adapter authenticated the caller.
 */
export class OperationUnauthorized extends Schema.TaggedErrorClass<OperationUnauthorized>()(
  "OperationUnauthorized",
  operationErrorFields
) {}

/** A request with the same ID is still being applied. */
export class OperationInProgress extends Schema.TaggedErrorClass<OperationInProgress>()(
  "OperationInProgress",
  { ...operationErrorFields, requestId: CliMutationRequestId }
) {}

/** Every failure an administration operation answers with. */
export type AdministrationOperationError =
  | OperationUnauthorized
  | OperationInputInvalid
  | OperationConflict
  | OperationNotFound
  | OperationUnavailable
  | OperationInProgress;
