import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Exit, Fiber } from "effect";
import {
  type WorkspaceE2EHostedPaymentPermitOptions,
  WorkspaceE2EHostedPaymentPermitService,
} from "./hosted-payment-permit.service";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hosted-payment-permit-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const permitLayer = (
  options: Partial<WorkspaceE2EHostedPaymentPermitOptions> = {}
) =>
  WorkspaceE2EHostedPaymentPermitService.layer({
    directory: join(directory, "permit"),
    pollIntervalMs: 5,
    ...options,
  });

const runWithPermit = <A, E>(
  effect: Effect.Effect<A, E, WorkspaceE2EHostedPaymentPermitService>,
  options: Partial<WorkspaceE2EHostedPaymentPermitOptions> = {}
) => Effect.runPromise(effect.pipe(Effect.provide(permitLayer(options))));

type HolderEvent = {
  readonly at: number;
  readonly event: "end" | "start";
  readonly label: string;
};

const spawnHolder = (input: {
  readonly capacity: number;
  readonly crashWhileHolding?: boolean;
  readonly holdMs: number;
  readonly label: string;
  readonly sessions: number;
}) =>
  Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "hosted-payment-permit.test-process.ts"),
      JSON.stringify({
        ...input,
        directory: join(directory, "permit"),
        logPath: join(directory, "holders.jsonl"),
      }),
    ],
    { stderr: "inherit", stdin: "ignore", stdout: "ignore" }
  );

const readHolderEvents = async (): Promise<HolderEvent[]> =>
  (await readFile(join(directory, "holders.jsonl"), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HolderEvent);

const peakHolders = (events: readonly HolderEvent[]) => {
  let active = 0;
  let peak = 0;
  // A release recorded at the same instant as an admission happened first.
  for (const { event } of [...events].sort(
    (left, right) =>
      left.at - right.at ||
      (left.event === "end" ? 0 : 1) - (right.event === "end" ? 0 : 1)
  )) {
    active += event === "start" ? 1 : -1;
    peak = Math.max(peak, active);
  }
  return peak;
};

test("admits at most three hosted sessions across worker processes", async () => {
  const holders = Array.from({ length: 6 }, (_, index) =>
    spawnHolder({
      capacity: 3,
      holdMs: 120,
      label: `worker-${index}`,
      sessions: 2,
    })
  );
  const exitCodes = await Promise.all(holders.map((holder) => holder.exited));

  const events = await readHolderEvents();
  expect(exitCodes).toEqual([0, 0, 0, 0, 0, 0]);
  expect(events.filter(({ event }) => event === "end")).toHaveLength(12);
  expect(peakHolders(events)).toBe(3);
}, 30_000);

test("admits waiting sessions in arrival order", async () => {
  const admitted: string[] = [];

  await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const firstHolding = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const session = (label: string) =>
        permit.withPermit(
          label,
          Effect.sync(() => {
            admitted.push(label);
          })
        );
      const first = yield* Effect.forkChild(
        permit.withPermit(
          "first",
          Deferred.succeed(firstHolding, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst))
          )
        )
      );
      yield* Deferred.await(firstHolding);
      const waiters = [];
      for (const label of ["second", "third", "fourth"]) {
        waiters.push(yield* Effect.forkChild(session(label)));
        // Each waiter takes its ticket before the next one arrives.
        yield* Effect.sleep("30 millis");
      }
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      for (const waiter of waiters) yield* Fiber.join(waiter);
    }),
    { capacity: 1 }
  );

  expect(admitted).toEqual(["second", "third", "fourth"]);
});

test("releases the slot when the hosted session fails", async () => {
  const result = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const failed = yield* Effect.exit(
        permit.withPermit(
          "failing",
          Effect.fail(new Error("Nexi rejected the card"))
        )
      );
      const next = yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
      return { failed, next };
    }),
    { capacity: 1 }
  );

  expect(Exit.isFailure(result.failed)).toBe(true);
  expect(result.next).toBe("admitted");
});

test("releases the slot when the case watchdog times out the session", async () => {
  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      yield* Effect.exit(
        permit
          .withPermit("stuck", Effect.never)
          .pipe(Effect.timeout("50 millis"))
      );
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    { capacity: 1 }
  );

  expect(next).toBe("admitted");
});

test("releases holding and waiting tickets on interruption", async () => {
  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const holding = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(
        permit.withPermit(
          "holder",
          Deferred.succeed(holding, undefined).pipe(
            Effect.andThen(Effect.never)
          )
        )
      );
      yield* Deferred.await(holding);
      const waiter = yield* Effect.forkChild(
        permit.withPermit("waiter", Effect.never)
      );
      yield* Effect.sleep("30 millis");
      yield* Fiber.interrupt(waiter);
      yield* Fiber.interrupt(holder);
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    { capacity: 1 }
  );

  expect(next).toBe("admitted");
});

test("reclaims the slot of a holder process that crashed", async () => {
  const crashed = spawnHolder({
    capacity: 1,
    crashWhileHolding: true,
    holdMs: 60_000,
    label: "crashed",
    sessions: 1,
  });
  expect(await crashed.exited).not.toBe(0);
  expect((await readHolderEvents()).map(({ event }) => event)).toEqual([
    "start",
  ]);

  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    // The lease alone would block for a minute; process exit frees the slot.
    { capacity: 1, leaseMs: 60_000 }
  );

  expect(next).toBe("admitted");
}, 30_000);

test("expires the lease of a live holder that stopped its heartbeat", async () => {
  const permitDirectory = join(directory, "permit");
  await mkdir(permitDirectory, { recursive: true });
  // A live process other than this one, as after PID reuse.
  await writeFile(
    join(permitDirectory, "ticket-000000"),
    JSON.stringify({ pid: process.ppid, token: "recycled" })
  );
  const startedAt = Date.now();

  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("3 seconds"));
    }),
    { capacity: 1, leaseMs: 300 }
  );

  expect(next).toBe("admitted");
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
});

test("ignores tickets this process leaked without a release", async () => {
  const permitDirectory = join(directory, "permit");
  await mkdir(permitDirectory, { recursive: true });
  await writeFile(
    join(permitDirectory, "ticket-000000"),
    JSON.stringify({ pid: process.pid, token: "leaked" })
  );
  const now = new Date();
  await utimes(join(permitDirectory, "ticket-000000"), now, now);

  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    { capacity: 1, leaseMs: 60_000 }
  );

  expect(next).toBe("admitted");
});
