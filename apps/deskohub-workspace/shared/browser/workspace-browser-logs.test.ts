import { afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Cause, Data, Effect } from "effect";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  WorkspaceBrowserLoggerLive,
  type WorkspaceBrowserLogRecord,
} from "./workspace-browser-logs";

class SyntheticRefreshError extends Data.TaggedError("SyntheticRefreshError")<{
  readonly message: string;
  readonly status: number;
}> {}

const email = testEmailAddress("browser-logs");

const log = (effect: Effect.Effect<void>) =>
  Effect.runPromise(effect.pipe(Effect.provide(WorkspaceBrowserLoggerLive)));

let detach: (() => void) | undefined;

const collect = () => {
  const records: WorkspaceBrowserLogRecord[] = [];
  detach = deliverWorkspaceBrowserLogs((record) => records.push(record));
  return records;
};

afterEach(() => {
  detach?.();
  detach = undefined;
  discardWorkspaceBrowserLogs();
});

describe("WorkspaceBrowserLoggerLive", () => {
  test("keeps only classification values from annotations, messages, and causes", async () => {
    const records = collect();

    await log(
      Effect.logError(
        "Synthetic refresh failed",
        {
          address: "Synthetic street 1",
          cause: new SyntheticRefreshError({ message: email, status: 503 }),
          code: "synthetic.code",
          failureCode: `failed for ${email}`,
        },
        Cause.fail(new SyntheticRefreshError({ message: email, status: 500 }))
      ).pipe(
        Effect.annotateLogs({
          email,
          operation: "test.operation",
          reason: "Synthetic Reason With Spaces",
        })
      )
    );

    expect(records).toEqual([
      {
        attributes: {
          code: "synthetic.code",
          errorType: "SyntheticRefreshError",
          failureCode: "[REDACTED]",
          operation: "test.operation",
          reason: "[REDACTED]",
        },
        body: "Synthetic refresh failed",
        level: "error",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(email);
  });

  test("replaces a non-string message with a fixed body", async () => {
    const records = collect();

    await log(Effect.logInfo({ email }));

    expect(records).toEqual([
      { attributes: {}, body: "Workspace browser log", level: "info" },
    ]);
  });

  test("holds records until a sink attaches and delivers each once", async () => {
    await log(Effect.logWarning("First synthetic record"));
    await log(Effect.logWarning("Second synthetic record"));

    const first = collect();
    detach?.();
    const second = collect();

    expect(first.map(({ body }) => body)).toEqual([
      "First synthetic record",
      "Second synthetic record",
    ]);
    expect(second).toEqual([]);
  });

  test("bounds the records held without a sink", async () => {
    await log(
      Effect.forEach(Array.from({ length: 60 }), () =>
        Effect.logWarning("Held synthetic record")
      ).pipe(Effect.asVoid)
    );

    expect(collect()).toHaveLength(50);
  });

  test("discards held records", async () => {
    await log(Effect.logWarning("Discarded synthetic record"));
    discardWorkspaceBrowserLogs();

    expect(collect()).toEqual([]);
  });

  test("holds later records again after the sink detaches", async () => {
    const delivered = collect();
    detach?.();
    detach = undefined;

    await log(Effect.logWarning("Held after detach"));

    expect(delivered).toEqual([]);
    expect(collect().map(({ body }) => body)).toEqual(["Held after detach"]);
  });

  test("a throwing sink loses only its own record", async () => {
    const delivered: string[] = [];
    let calls = 0;
    detach = deliverWorkspaceBrowserLogs((record) => {
      calls += 1;
      if (calls === 1) throw new Error("sink unavailable");
      delivered.push(record.body);
    });

    await log(Effect.logWarning("Lost synthetic record"));
    await log(Effect.logWarning("Delivered synthetic record"));

    expect(delivered).toEqual(["Delivered synthetic record"]);
  });
});
