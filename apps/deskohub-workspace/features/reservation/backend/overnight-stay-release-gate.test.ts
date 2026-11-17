import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  ensureCoworkStayOffered,
  OvernightStayReleaseGate,
} from "./overnight-stay-release-gate";

const run = (
  stay: "day" | "overnight" | undefined,
  gate: ReturnType<typeof OvernightStayReleaseGate.fromDecision>
) =>
  Effect.runPromise(
    ensureCoworkStayOffered(stay).pipe(
      Effect.result,
      Effect.map((result) => result._tag),
      Effect.provide(gate)
    )
  );

describe("ensureCoworkStayOffered", () => {
  test("accepts an overnight stay only while the gate is open", async () => {
    expect(
      await run("overnight", OvernightStayReleaseGate.fromDecision(true))
    ).toBe("Success");
    expect(
      await run("overnight", OvernightStayReleaseGate.fromDecision(false))
    ).toBe("Failure");
  });

  test("never reads the gate for a day stay or no stay", async () => {
    const unread = OvernightStayReleaseGate.fromEvaluation(
      Effect.die("the gate was read")
    );
    expect(await run("day", unread)).toBe("Success");
    expect(await run(undefined, unread)).toBe("Success");
  });
});
