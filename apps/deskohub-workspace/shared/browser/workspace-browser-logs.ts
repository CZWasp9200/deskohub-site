import { Effect, Option, Predicate, References } from "effect";
import {
  censorErrorClassificationValue,
  errorClassificationKeys,
} from "@/shared/utils/log-classification";

type WorkspaceBrowserLogAttributes = Record<string, string | number | boolean>;

/**
 * A browser failure reduced to classification attributes: the run's
 * operation and boundary, the failure code, and the error's tag or name.
 * Error messages, stacks, payloads, and every other value are never part of
 * a record.
 */
export interface WorkspaceBrowserLogRecord {
  readonly attributes: Readonly<WorkspaceBrowserLogAttributes>;
  readonly body: string;
  readonly level: "warn";
}

type WorkspaceBrowserLogSink = (record: WorkspaceBrowserLogRecord) => void;

const maxPendingRecords = 50;
const pendingRecords: WorkspaceBrowserLogRecord[] = [];
let attachedSink: WorkspaceBrowserLogSink | undefined;

/**
 * Attaches the sink that receives browser logs, first the records logged
 * while no sink was attached, then each later record once. Returns the detach
 * function. A sink that throws loses that record and nothing else.
 */
export const deliverWorkspaceBrowserLogs = (
  sink: WorkspaceBrowserLogSink
): (() => void) => {
  attachedSink = sink;
  for (const record of pendingRecords.splice(0)) deliverRecord(sink, record);

  return () => {
    if (attachedSink === sink) attachedSink = undefined;
  };
};

/** Drops records still waiting for a sink, such as after consent withdrawal. */
export const discardWorkspaceBrowserLogs = (): void => {
  pendingRecords.length = 0;
};

const deliverRecord = Option.liftThrowable(
  (sink: WorkspaceBrowserLogSink, record: WorkspaceBrowserLogRecord) =>
    sink(record)
);

/**
 * Records one censored failure for PostHog Logs, annotated with the
 * `operation` and `boundary` of the `runWorkspaceBrowserEffect` run. Use a
 * stable, low-cardinality `failureCode` without IDs, URLs, or payload data.
 * Never fails: a failing projection or sink loses the record.
 */
export const reportWorkspaceBrowserFailure = (
  failureCode: string,
  cause: unknown
): Effect.Effect<void> =>
  Effect.withFiber((fiber) =>
    Effect.sync(() =>
      holdOrDeliver(
        toFailureRecord(
          failureCode,
          cause,
          fiber.getRef(References.CurrentLogAnnotations)
        )
      )
    )
  ).pipe(Effect.ignoreCause);

const holdOrDeliver = (failure: WorkspaceBrowserLogRecord) => {
  if (attachedSink !== undefined) {
    deliverRecord(attachedSink, failure);
  } else if (pendingRecords.length < maxPendingRecords) {
    pendingRecords.push(failure);
  }
};

const toFailureRecord = <Annotations>(
  failureCode: string,
  cause: unknown,
  annotations: Annotations
): WorkspaceBrowserLogRecord => {
  const attributes: WorkspaceBrowserLogAttributes = {};
  addClassification(attributes, annotations, annotationKeys);
  addClassification(attributes, { failureCode }, ["failureCode"]);
  addErrorType(attributes, cause);

  return { attributes, body: "Workspace browser failure", level: "warn" };
};

const annotationKeys = ["boundary", ...errorClassificationKeys] as const;

const addClassification = <T>(
  attributes: WorkspaceBrowserLogAttributes,
  source: T,
  keys: readonly string[]
) => {
  if (!Predicate.isObject(source)) return;

  for (const key of keys) {
    if (!Predicate.hasProperty(source, key)) continue;
    const value = censorErrorClassificationValue(source[key]);
    if (
      Predicate.isString(value) ||
      Predicate.isNumber(value) ||
      Predicate.isBoolean(value)
    ) {
      attributes[key] = value;
    }
  }
};

const addErrorType = <T>(
  attributes: WorkspaceBrowserLogAttributes,
  error: T
) => {
  if (!Predicate.isObject(error)) return;

  const errorType = Predicate.hasProperty(error, "_tag")
    ? error._tag
    : Predicate.hasProperty(error, "name") && error.name;
  if (Predicate.isString(errorType)) {
    attributes.errorType = String(censorErrorClassificationValue(errorType));
  }
};
