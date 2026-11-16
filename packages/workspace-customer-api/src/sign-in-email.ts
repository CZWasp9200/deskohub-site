import { Clock, Effect, Schedule, Schema, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

/**
 * The sign-in email (`POST /api/auth/sign-in/magic-link`) as the site and
 * the app's web bundle both offer it. It has its own entry point so the app
 * can pace resends without the HTTP API definitions the package root builds
 * when it loads.
 */

/** How long the customer waits before asking for another email. */
export const SIGN_IN_EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * When the server will next accept a sign-in email for the address, as of
 * the response that carries it: the send answer while sign-in codes are on,
 * and the `SIGN_IN_EMAIL_LIMIT_REACHED` refusal. Other sends to the same
 * address can move it. On the wire it is an ISO 8601 UTC instant.
 */
export const NextSignInEmailAt = Schema.DateTimeUtcFromString.annotate({
  identifier: "NextSignInEmailAt",
  description:
    "ISO 8601 UTC instant when the server next accepts a sign-in email for this address.",
});
export type NextSignInEmailAt = typeof NextSignInEmailAt.Type;

/**
 * `NextSignInEmailAt` as a Better Auth client hands it over: its JSON parser
 * revives ISO 8601 strings into `Date`s, so a client answer carries either
 * the wire string or a `Date`. Decodes both to the same instant.
 */
export const NextSignInEmailAtFromClient = Schema.Union([
  NextSignInEmailAt,
  Schema.DateTimeUtcFromDate,
]).annotate({ identifier: "NextSignInEmailAtFromClient" });

const secondsUntil = (availableAt: number, now: number) =>
  Math.max(0, Math.ceil((availableAt - now) / 1000));

/**
 * Whole seconds left until another email may be requested, ticking every
 * second and settling at 0. Keyed by the instant the cooldown ends.
 */
export const resendCooldownSecondsAtom = Atom.family((availableAt: number) => {
  const initialSeconds = secondsUntil(availableAt, Date.now());
  const countdown = Atom.make(
    Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
      Stream.mapEffect(() =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => secondsUntil(availableAt, now))
        )
      ),
      Stream.takeUntil((seconds) => seconds === 0)
    ),
    { initialValue: initialSeconds }
  );
  return Atom.map(countdown, (result) =>
    AsyncResult.getOrElse(result, () => initialSeconds)
  );
});
