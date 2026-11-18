import { spyOn } from "bun:test";
import { inspect } from "node:util";
import { Cause, Effect, Predicate } from "effect";
import { WorkspaceLoggerLive } from "@/shared/backend/logging/censorship";

/** A text something could print of a value, named for the failure message. */
export interface RenderedRepresentation {
  readonly name: string;
  readonly text: string;
}

const errorGetters = ["message", "stack", "name", "cause"] as const;

// Every string the object graph holds: own properties, symbol-keyed and
// non-enumerable ones included, Map and Set entries, and the getters an
// error computes on its prototype, such as a query error's message.
const collectStrings = <T>(root: T) => {
  const strings: string[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Predicate.isString(value)) {
      strings.push(value);
      continue;
    }
    if (!Predicate.isObject(value) || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) {
      for (const [key, entry] of value) pending.push(key, entry);
    }
    if (value instanceof Set) pending.push(...value);
    const keys = new Set<PropertyKey>(Reflect.ownKeys(value));
    if (value instanceof Error) for (const key of errorGetters) keys.add(key);
    for (const key of keys) {
      if (Predicate.isString(key)) strings.push(key);
      try {
        pending.push(Reflect.get(value, key));
      } catch {
        // A throwing getter renders nothing.
      }
    }
  }
  return strings.join("\n");
};

const tryRender = (render: () => string | undefined) => {
  try {
    return render() ?? "";
  } catch (error) {
    return `threw ${String(error)}`;
  }
};

// What the Workspace logger writes for the value, as an annotation and as the
// cause of a failed run.
const renderWorkspaceLog = async <T>(value: T) => {
  const methods = ["debug", "error", "info", "log", "trace", "warn"] as const;
  const spies = methods.map((method) =>
    spyOn(console, method).mockImplementation(() => {})
  );
  try {
    await Effect.runPromise(
      Effect.all([
        Effect.logError("failure", { cause: value }),
        Effect.fail(value).pipe(
          Effect.catchCause((cause) => Effect.logError("failure", cause))
        ),
      ]).pipe(Effect.provide(WorkspaceLoggerLive))
    );
    return spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((argument) =>
        Predicate.isString(argument)
          ? argument
          : inspect(argument, { depth: Number.POSITIVE_INFINITY })
      )
      .join("\n");
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
};

/**
 * Every text a log line, a response or a debugger could print of `value`: its
 * whole object graph, `String`, `util.inspect` of every hidden property at
 * any depth, JSON, Effect's rendering of it as a failure, and the Workspace
 * logger's output.
 */
const renderEveryRepresentation = async <T>(
  value: T
): Promise<readonly RenderedRepresentation[]> => [
  { name: "object graph", text: collectStrings(value) },
  { name: "String", text: tryRender(() => String(value)) },
  {
    name: "util.inspect",
    text: inspect(value, {
      depth: Number.POSITIVE_INFINITY,
      getters: true,
      showHidden: true,
    }),
  },
  { name: "JSON", text: tryRender(() => JSON.stringify(value)) },
  { name: "Cause.pretty", text: Cause.pretty(Cause.fail(value)) },
  { name: "Workspace log", text: await renderWorkspaceLog(value) },
];

/**
 * The `texts` some representation of `value` contains, by representation;
 * empty when none does.
 */
export const findRenderedTexts = async <T>(
  value: T,
  texts: readonly string[]
) =>
  (await renderEveryRepresentation(value)).flatMap(({ name, text }) =>
    texts
      .filter((sensitive) => text.includes(sensitive))
      .map((sensitive) => `${name} renders ${JSON.stringify(sensitive)}`)
  );

// An enum value, such as a document kind, which every document of its kind
// holds and source paths may spell.
const enumValuePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The string values of `document` long enough to identify it, other than
 * enum values and the `known` ones a failure may legitimately name, such as
 * the record's id.
 */
export const identifyingTexts = <T>(
  document: T,
  known: readonly string[]
): readonly string[] => {
  const texts = new Set<string>();
  const pending: unknown[] = [document];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Predicate.isString(value)) {
      if (
        value.length >= 8 &&
        !enumValuePattern.test(value) &&
        !known.includes(value)
      ) {
        texts.add(value);
      }
    } else if (Predicate.isObject(value)) {
      pending.push(...Object.values(value));
    }
  }
  return [...texts];
};
