import { describe, expect, test } from "bun:test";
import { DateTime, Deferred, Effect, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  type ReservationListRow,
  reservationGroups,
} from "../account/reservations/reservation-list-model";
import {
  reservationsCacheName,
  SavedReservations,
} from "../account/reservations/reservations-cache";
import {
  type ReservationsList,
  savedReservationsAtom,
} from "../account/reservations/reservations-list-state";
import { accountStorageKey } from "../customer-api/account-scoped-storage";
import {
  makeCustomerDataRegistry,
  settle,
} from "../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../customer-api/testing/fake-customer-data";
import {
  FakeWorkspace,
  fakeWorkspaceOrigin,
} from "../customer-api/testing/fake-workspace";
import {
  decideStartTab,
  startTabAtom,
  startTabOf,
  startTabReadBudget,
} from "./start-tab";

const now = DateTime.makeUnsafe("2026-11-16T12:00:00Z");
const row = (
  id: string,
  change: Partial<ReservationListRow> = {}
): ReservationListRow => ({
  id,
  product: { kind: "meeting-room" },
  startsAt: "2026-11-20T09:00:00Z",
  endsAt: "2026-11-20T17:00:00Z",
  seats: 2,
  status: "confirmed",
  ...change,
});
const saved = (
  current: ReadonlyArray<ReservationListRow>,
  past: ReadonlyArray<ReservationListRow> = []
): Option.Option<ReservationsList> =>
  Option.some({
    groups: reservationGroups({ current, past, unavailable: [] }, now),
    savedAt: Option.some(now),
  });

describe("startTabOf", () => {
  test("nothing saved on the device opens Book", () => {
    expect(startTabOf(Option.none())).toBe("book");
  });

  test("an upcoming or running reservation opens Reservations", () => {
    expect(startTabOf(saved([row("upcoming")]))).toBe("reservations");
    expect(
      startTabOf(
        saved([
          row("running", {
            startsAt: "2026-11-16T09:00:00Z",
            endsAt: "2026-11-16T17:00:00Z",
          }),
        ])
      )
    ).toBe("reservations");
    for (const status of ["pending", "requires-attention"] as const) {
      expect(startTabOf(saved([row(status, { status })]))).toBe("reservations");
    }
  });

  test("only past, ended or cancelled reservations open Book", () => {
    expect(startTabOf(saved([]))).toBe("book");
    expect(
      startTabOf(saved([], [row("past", { endsAt: "2026-11-01T10:00:00Z" })]))
    ).toBe("book");
    expect(
      startTabOf(
        saved([row("ended since saved", { endsAt: "2026-11-16T11:00:00Z" })])
      )
    ).toBe("book");
    expect(startTabOf(saved([row("cancelled", { status: "cancelled" })]))).toBe(
      "book"
    );
  });

  test("one reservation coming up among cancelled ones is enough", () => {
    expect(
      startTabOf(
        saved([row("cancelled", { status: "cancelled" }), row("upcoming")])
      )
    ).toBe("reservations");
  });
});

describe("decideStartTab", () => {
  const upcoming = saved([row("upcoming")]);
  const run = <A>(effect: Effect.Effect<A>) =>
    Effect.runPromise(Effect.provide(effect, TestClock.layer()));

  test("a read that answers within the budget decides", async () => {
    const tab = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          decideStartTab(Effect.as(Effect.sleep("400 millis"), upcoming))
        );
        yield* TestClock.adjust("400 millis");
        return yield* Fiber.join(fiber);
      })
    );
    expect(tab).toBe("reservations");
  });

  test("a read still running after the budget opens Book, and its late answer is dropped", async () => {
    const result = await run(
      Effect.gen(function* () {
        const answered = yield* Deferred.make<void>();
        const lateRead = Effect.sleep("2 seconds").pipe(
          Effect.andThen(Deferred.succeed(answered, undefined)),
          Effect.as(upcoming)
        );
        const fiber = yield* Effect.forkChild(decideStartTab(lateRead));
        yield* TestClock.adjust(startTabReadBudget);
        const tab = yield* Fiber.join(fiber);
        yield* TestClock.adjust("5 seconds");
        return { tab, lateAnswer: yield* Deferred.isDone(answered) };
      })
    );
    expect(result).toEqual({ tab: "book", lateAnswer: false });
  });

  test("a read that never answers opens Book", async () => {
    const tab = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(decideStartTab(Effect.never));
        yield* TestClock.adjust(startTabReadBudget);
        return yield* Fiber.join(fiber);
      })
    );
    expect(tab).toBe("book");
  });
});

describe("startTabAtom", () => {
  const chosen = (tab: string) =>
    expect.objectContaining({ _tag: "Success", success: tab });

  const setup = () => {
    const workspace = FakeWorkspace.forKind("linked");
    const device = makeFakeDevice();
    const registry = makeCustomerDataRegistry(
      fakeCustomerDataLayer({ workspace, device })
    );
    const cacheKey = accountStorageKey(reservationsCacheName, {
      apiOrigin: fakeWorkspaceOrigin,
      accountId: workspace.data.accountId,
    });
    return { workspace, device, registry, cacheKey };
  };

  test("decides from the device alone: with nothing saved, Book, without reading the account's reservations", async () => {
    const { registry, workspace } = setup();
    const result = await settle(registry, startTabAtom);
    expect(result).toEqual(chosen("book"));
    expect(workspace.calls).toEqual([]);
  });

  test("an upcoming reservation saved on the last visit opens Reservations", async () => {
    const { registry, device, cacheKey } = setup();
    device.storage.set(
      cacheKey,
      Schema.encodeSync(Schema.fromJsonString(SavedReservations))({
        savedAt: DateTime.nowUnsafe(),
        history: {
          current: [
            row("upcoming", {
              startsAt: new Date(Date.now() + 86_400_000).toISOString(),
              endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
            }),
          ],
          past: [],
          unavailable: [],
        },
      })
    );
    const result = await settle(registry, startTabAtom);
    expect(result).toEqual(chosen("reservations"));
  });

  test("is decided once per account: a list saved later doesn't move it", async () => {
    const { registry, device, cacheKey } = setup();
    expect(await settle(registry, startTabAtom)).toEqual(chosen("book"));
    device.storage.set(
      cacheKey,
      Schema.encodeSync(Schema.fromJsonString(SavedReservations))({
        savedAt: DateTime.nowUnsafe(),
        history: {
          current: [
            row("upcoming", {
              startsAt: new Date(Date.now() + 86_400_000).toISOString(),
              endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
            }),
          ],
          past: [],
          unavailable: [],
        },
      })
    );
    // The saved list itself is read again; the start tab stays.
    registry.refresh(savedReservationsAtom);
    expect(await settle(registry, savedReservationsAtom)).toMatchObject({
      _tag: "Success",
    });
    expect(await settle(registry, startTabAtom)).toEqual(chosen("book"));
  });

  test("an unreadable saved entry reads as nothing saved: Book", async () => {
    const { registry, device, cacheKey } = setup();
    device.storage.set(cacheKey, "{broken");
    const result = await settle(registry, startTabAtom);
    expect(result).toEqual(chosen("book"));
  });
});
