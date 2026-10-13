import {
  Cause,
  Logger,
  type LogLevel,
  Option,
  Predicate,
  References,
} from "effect";
import {
  censorErrorClassificationValue,
  errorClassificationKeys,
} from "@/shared/utils/log-classification";

type WorkspaceBrowserLogAttributes = Record<string, string | number | boolean>;

type WorkspaceBrowserLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

/**
 * A browser log reduced to its message and classification attributes: the
 * run's operation and boundary, codes, tags, and statuses. Error messages,
 * stacks, payloads, and every other value are never part of a record.
 */
export interface WorkspaceBrowserLogRecord {
  readonly attributes: Readonly<WorkspaceBrowserLogAttributes>;
  readonly body: string;
  readonly level: WorkspaceBrowserLogLevel;
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

const recordLog = Option.liftThrowable(
  (options: Logger.Options<unknown>): void => {
    const record = toWorkspaceBrowserLogRecord(options);
    if (record === undefined) return;

    if (attachedSink !== undefined) {
      deliverRecord(attachedSink, record);
    } else if (pendingRecords.length < maxPendingRecords) {
      pendingRecords.push(record);
    }
  }
);

// A failing projection or sink loses the record; logging never fails the run.
const WorkspaceBrowserLogger = Logger.make((options) => {
  recordLog(options);
});

/** Replaces Effect's console logger, which would print raw causes. */
export const WorkspaceBrowserLoggerLive = Logger.layer([
  WorkspaceBrowserLogger,
]);

const toWorkspaceBrowserLogRecord = (
  options: Logger.Options<unknown>
): WorkspaceBrowserLogRecord | undefined => {
  const level = browserLogLevels[options.logLevel];
  if (level === undefined) return undefined;

  const messages = Array.isArray(options.message)
    ? options.message
    : [options.message];
  const [body] = messages;
  const attributes: WorkspaceBrowserLogAttributes = {};

  addClassification(
    attributes,
    options.fiber.getRef(References.CurrentLogAnnotations),
    annotationKeys
  );
  for (const message of messages.slice(1)) {
    addClassification(attributes, message, errorClassificationKeys);
    if (Predicate.hasProperty(message, "cause")) {
      addErrorType(attributes, message.cause);
    }
  }
  if (
    options.cause.reasons.some(
      (reason) => Cause.isFailReason(reason) || Cause.isDieReason(reason)
    )
  ) {
    addErrorType(attributes, Cause.squash(options.cause));
  }

  return {
    attributes,
    body: Predicate.isString(body) ? body : "Workspace browser log",
    level,
  };
};

const browserLogLevels: Partial<
  Record<LogLevel.LogLevel, WorkspaceBrowserLogLevel>
> = {
  Debug: "debug",
  Error: "error",
  Fatal: "fatal",
  Info: "info",
  Trace: "trace",
  Warn: "warn",
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
