import { describe, expect, test } from "bun:test";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { HandoffTabPage } from "./close-tab-on-handoff";
import {
  signInElsewhereCheckInterval,
  signInEmailLinkLifetime,
  watchSignInElsewhere,
} from "./sign-in-elsewhere-watch";

/** A page whose visibility a test changes, recording what it does. */
const fakePage = () => {
  let visibility: DocumentVisibilityState = "visible";
  const listeners = new Set<() => void>();
  const events: string[] = [];
  const page: HandoffTabPage = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    close: () => events.push("close"),
  };
  return {
    page,
    events,
    become: (next: DocumentVisibilityState) => {
      visibility = next;
      for (const listener of [...listeners]) listener();
    },
    listening: () => listeners.size,
  };
};

type Answer = boolean | "unavailable";

/** A status the test answers in turn; it says no once the answers run out. */
const fakeStatus = (answers: Answer[] = []) => {
  let asked = 0;
  const isCompleted = Effect.suspend(() => {
    asked += 1;
    const answer = answers.shift() ?? false;
    return answer === "unavailable"
      ? Effect.fail("unavailable" as const)
      : Effect.succeed(answer);
  });
  return { isCompleted, asked: () => asked };
};

const run = <A>(effect: Effect.Effect<A>) =>
  Effect.runPromise(Effect.provide(effect, TestClock.layer()));

/** Lets the watch take a page event before the test looks. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 5; turn += 1) yield* Effect.yieldNow;
});

const start = (
  tab: ReturnType<typeof fakePage>,
  status: ReturnType<typeof fakeStatus>
) =>
  Effect.forkChild(
    watchSignInElsewhere({
      page: tab.page,
      until: Duration.toMillis(signInEmailLinkLifetime),
      isCompleted: status.isCompleted,
      forgetSignIn: () => tab.events.push("forget"),
    })
  );

describe("watching for a sign-in elsewhere", () => {
  test("asks every few seconds while the page waits", async () => {
    const tab = fakePage();
    const status = fakeStatus();
    const asked = await run(
      Effect.gen(function* () {
        yield* start(tab, status);
        const counts = [status.asked()];
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        counts.push(status.asked());
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        counts.push(status.asked());
        return counts;
      })
    );
    expect(asked).toEqual([0, 1, 2]);
    expect(tab.events).toEqual([]);
  });

  test("asks at once when the page comes back into view", async () => {
    const tab = fakePage();
    const status = fakeStatus();
    const asked = await run(
      Effect.gen(function* () {
        yield* start(tab, status);
        yield* settle;
        tab.become("hidden");
        yield* settle;
        const whileHidden = status.asked();
        tab.become("visible");
        yield* settle;
        return { whileHidden, back: status.asked() };
      })
    );
    expect(asked).toEqual({ whileHidden: 0, back: 1 });
  });

  test("forgets the sign-in and closes the tab once an attempt signed in", async () => {
    const tab = fakePage();
    const status = fakeStatus([false, true]);
    const result = await run(
      Effect.gen(function* () {
        const watch = yield* start(tab, status);
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        const signedIn = yield* Fiber.join(watch);
        yield* TestClock.adjust(Duration.minutes(1));
        return { signedIn, asked: status.asked() };
      })
    );
    expect(result).toEqual({ signedIn: true, asked: 2 });
    expect(tab.events).toEqual(["forget", "close"]);
    expect(tab.listening()).toBe(0);
  });

  test("asks again on the next tick after a failed answer", async () => {
    const tab = fakePage();
    const status = fakeStatus(["unavailable", true]);
    const signedIn = await run(
      Effect.gen(function* () {
        const watch = yield* start(tab, status);
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        return yield* Fiber.join(watch);
      })
    );
    expect(signedIn).toBe(true);
    expect(tab.events).toEqual(["forget", "close"]);
  });

  test("stops when the newest link expires, and leaves the tab", async () => {
    const tab = fakePage();
    const status = fakeStatus();
    const result = await run(
      Effect.gen(function* () {
        const watch = yield* start(tab, status);
        yield* TestClock.adjust(signInEmailLinkLifetime);
        const signedIn = yield* Fiber.join(watch);
        const askedByExpiry = status.asked();
        yield* TestClock.adjust(Duration.minutes(1));
        tab.become("visible");
        yield* settle;
        return { signedIn, askedByExpiry, askedLater: status.asked() };
      })
    );
    expect(result.signedIn).toBe(false);
    expect(result.askedLater).toBe(result.askedByExpiry);
    expect(tab.events).toEqual([]);
    expect(tab.listening()).toBe(0);
  });

  test("stops asking once interrupted, as when the page finishes or starts over", async () => {
    const tab = fakePage();
    const status = fakeStatus();
    const result = await run(
      Effect.gen(function* () {
        const watch = yield* start(tab, status);
        yield* TestClock.adjust(signInElsewhereCheckInterval);
        yield* Fiber.interrupt(watch);
        yield* TestClock.adjust(Duration.minutes(1));
        tab.become("visible");
        yield* settle;
        return status.asked();
      })
    );
    expect(result).toBe(1);
    expect(tab.events).toEqual([]);
    expect(tab.listening()).toBe(0);
  });
});
