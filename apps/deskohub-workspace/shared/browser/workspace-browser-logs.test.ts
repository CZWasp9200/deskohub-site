import { afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Data, Effect } from "effect";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  reportWorkspaceBrowserFailure,
  type WorkspaceBrowserLogRecord,
} from "./workspace-browser-logs";

class SyntheticRefreshError extends Data.TaggedError("SyntheticRefreshError")<{
  readonly message: string;
  readonly status: number;
}> {}

const email = testEmailAddress("browser-logs");

const report = (
  failureCode: string,
  cause: Error | string = new Error(email)
) => Effect.runPromise(reportWorkspaceBrowserFailure(failureCode, cause));

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

describe("reportWorkspaceBrowserFailure", () => {
  test("keeps only classification values from annotations, the code, and the cause", async () => {
    const records = collect();

    await Effect.runPromise(
      reportWorkspaceBrowserFailure(
        "synthetic.refresh-failed",
        new SyntheticRefreshError({ message: email, status: 503 })
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
          errorType: "SyntheticRefreshError",
          failureCode: "synthetic.refresh-failed",
          operation: "test.operation",
          reason: "[REDACTED]",
        },
        body: "Workspace browser failure",
        level: "warn",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(email);
  });

  test("censors a failure code that is not a stable identifier", async () => {
    const records = collect();

    await report(`failed for ${email}`, "raw string cause");

    expect(records).toEqual([
      {
        attributes: { failureCode: "[REDACTED]" },
        body: "Workspace browser failure",
        level: "warn",
      },
    ]);
  });

  test("holds records until a sink attaches and delivers each once", async () => {
    await report("synthetic.first");
    await report("synthetic.second");

    const first = collect();
    detach?.();
    const second = collect();

    expect(first.map(({ attributes }) => attributes.failureCode)).toEqual([
      "synthetic.first",
      "synthetic.second",
    ]);
    expect(second).toEqual([]);
  });

  test("bounds the records held without a sink", async () => {
    for (let index = 0; index < 60; index += 1) {
      await report("synthetic.held");
    }

    expect(collect()).toHaveLength(50);
  });

  test("discards held records", async () => {
    await report("synthetic.discarded");
    discardWorkspaceBrowserLogs();

    expect(collect()).toEqual([]);
  });

  test("holds later records again after the sink detaches", async () => {
    const delivered = collect();
    detach?.();
    detach = undefined;

    await report("synthetic.after-detach");

    expect(delivered).toEqual([]);
    expect(collect().map(({ attributes }) => attributes.failureCode)).toEqual([
      "synthetic.after-detach",
    ]);
  });

  test("a throwing sink loses only its own record", async () => {
    const delivered: string[] = [];
    let calls = 0;
    detach = deliverWorkspaceBrowserLogs((record) => {
      calls += 1;
      if (calls === 1) throw new Error("sink unavailable");
      delivered.push(String(record.attributes.failureCode));
    });

    await report("synthetic.lost");
    await report("synthetic.delivered");

    expect(delivered).toEqual(["synthetic.delivered"]);
  });
});
