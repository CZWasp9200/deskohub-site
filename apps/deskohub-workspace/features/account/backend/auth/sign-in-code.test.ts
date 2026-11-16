import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { memoryAdapter } from "better-auth/adapters/memory";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import { digestVerificationKey, signInEmailLimit } from "./auth-options";
import { reserveSignInEmail } from "./sign-in-code";

const windowMs = signInEmailLimit.window * 1000;
const startedAt = Date.UTC(2026, 10, 15, 12);

/** A fresh verification table and the address's sends against it. */
const sendsTo = (email: string) => {
  const store = { verification: [] };
  const verifications = memoryAdapter(store)({});
  const send = (at: number) =>
    TestClock.setTime(at).pipe(
      Effect.andThen(reserveSignInEmail({ verifications, email })),
      Effect.map(({ admitted, nextSignInEmailAt }) => ({
        admitted,
        nextSignInEmailAt: DateTime.toEpochMillis(nextSignInEmailAt),
      }))
    );
  /** A send record another request wrote, expiring at `expiresAt`. */
  const recordedSend = (expiresAt: number) =>
    Effect.promise(async () =>
      verifications.create({
        model: "verification",
        data: {
          identifier: `sign-in-email-${await digestVerificationKey(email.toLowerCase())}`,
          value: "sent",
          expiresAt: new Date(expiresAt),
          createdAt: new Date(expiresAt - windowMs),
          updatedAt: new Date(expiresAt - windowMs),
        },
      })
    );
  return { store, send, recordedSend };
};

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));

/** One send a minute, starting at `startedAt`. */
const minute = (index: number) => startedAt + index * 60 * 1000;

describe("reserveSignInEmail", () => {
  test("under the limit, the next email is available now", async () => {
    const { send } = sendsTo(testEmailAddress("next-email-under"));

    const sends = await run(
      Effect.forEach(
        Array.from({ length: signInEmailLimit.max - 1 }, (_, index) => index),
        (index) => send(minute(index))
      )
    );

    expect(sends).toEqual(
      sends.map((_, index) => ({
        admitted: true,
        nextSignInEmailAt: minute(index),
      }))
    );
  });

  test("the send that reaches the limit names the oldest record's expiry", async () => {
    const { send } = sendsTo(testEmailAddress("next-email-at-limit"));

    const last = await run(
      Effect.forEach(
        Array.from({ length: signInEmailLimit.max }, (_, index) => index),
        (index) => send(minute(index))
      ).pipe(Effect.map((sends) => sends.at(-1)))
    );

    expect(last).toEqual({
      admitted: true,
      nextSignInEmailAt: minute(0) + windowMs,
    });
  });

  test("a refused send is withdrawn and still names the instant", async () => {
    const { store, send } = sendsTo(testEmailAddress("next-email-over"));

    const refused = await run(
      Effect.forEach(
        Array.from({ length: signInEmailLimit.max }, (_, index) => index),
        (index) => send(minute(index))
      ).pipe(Effect.andThen(send(minute(signInEmailLimit.max))))
    );

    expect(refused).toEqual({
      admitted: false,
      nextSignInEmailAt: minute(0) + windowMs,
    });
    expect(store.verification).toHaveLength(signInEmailLimit.max);
  });

  test("with more rows than the limit, names the expiry that brings it back under", async () => {
    // Concurrent sends can leave many rows; the answer depends on the newest.
    const { send, recordedSend } = sendsTo(
      testEmailAddress("next-email-crowded")
    );
    const expiries = Array.from(
      { length: 120 },
      (_, index) => startedAt + windowMs / 2 + index * 1000
    );

    const refused = await run(
      Effect.forEach(expiries, recordedSend).pipe(
        Effect.andThen(send(startedAt))
      )
    );

    expect(refused).toEqual({
      admitted: false,
      nextSignInEmailAt: expiries.at(-signInEmailLimit.max)!,
    });
  });

  test("once the oldest record expires, the next send names the following one", async () => {
    const { send } = sendsTo(testEmailAddress("next-email-aged"));

    const afterExpiry = await run(
      Effect.forEach(
        Array.from({ length: signInEmailLimit.max }, (_, index) => index),
        (index) => send(minute(index))
      ).pipe(Effect.andThen(send(minute(0) + windowMs)))
    );

    expect(afterExpiry).toEqual({
      admitted: true,
      nextSignInEmailAt: minute(1) + windowMs,
    });
  });
});
