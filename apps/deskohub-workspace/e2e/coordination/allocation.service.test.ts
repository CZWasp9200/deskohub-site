import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { releaseAllocationOnFailure } from "./allocation.service";

test("releases an allocation when the owning operation is interrupted", async () => {
  let releases = 0;

  const exit = await Effect.runPromiseExit(
    releaseAllocationOnFailure(
      Effect.interrupt,
      Effect.sync(() => {
        releases += 1;
      })
    )
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(releases).toBe(1);
});

test("does not release an allocation after the owning operation succeeds", async () => {
  let releases = 0;

  const value = await Effect.runPromise(
    releaseAllocationOnFailure(
      Effect.succeed("published"),
      Effect.sync(() => {
        releases += 1;
      })
    )
  );

  expect(value).toBe("published");
  expect(releases).toBe(0);
});
