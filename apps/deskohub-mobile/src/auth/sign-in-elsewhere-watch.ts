import { Clock, Duration, Effect, Option } from "effect";
import type { HandoffTabPage } from "./close-tab-on-handoff";

/**
 * The sign-in page the app opened waits on its "Check your email" step while
 * the customer reads the email. When the email's link opens in the app
 * instead, the app signs in and the page never learns of it by itself; on
 * Chrome's first run the page stays in a task of its own, and the back
 * gesture reveals it. So the page asks whether its sign-in attempts signed
 * in elsewhere, and leaves once one did.
 */

/** How often the page asks while it waits. */
export const signInElsewhereCheckInterval = Duration.seconds(5);

/** A sign-in email's link signs in for ten minutes after it is sent. */
export const signInEmailLinkLifetime = Duration.minutes(10);

export interface SignInElsewhereWatch<E, R> {
  readonly page: HandoffTabPage;
  /** Epoch ms when the newest email's link expires; the page stops asking then. */
  readonly until: number;
  /** Whether one of the page's attempts signed in; failures count as no. */
  readonly isCompleted: Effect.Effect<boolean, E, R>;
  /** Forgets what the finished sign-in leaves behind, before the tab closes. */
  readonly forgetSignIn: () => void;
}

/** The next time the page comes back into view. */
const backInView = (page: HandoffTabPage) =>
  Effect.callback<void>((resume) => {
    const onChange = () => {
      if (page.visibilityState === "visible") resume(Effect.void);
    };
    page.addEventListener("visibilitychange", onChange);
    return Effect.sync(() =>
      page.removeEventListener("visibilitychange", onChange)
    );
  });

/**
 * Asks every few seconds, and at once whenever the page comes back into view,
 * until an attempt signed in or the newest link expires. A signed-in attempt
 * forgets the sign-in and closes the tab; the result says whether one did,
 * so a tab the browser keeps open can show that the customer is signed in.
 * Interrupting it stops the asking.
 */
export const watchSignInElsewhere = <E, R>({
  page,
  until,
  isCompleted,
  forgetSignIn,
}: SignInElsewhereWatch<E, R>): Effect.Effect<boolean, never, R> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const ask = Effect.race(
      Effect.sleep(signInElsewhereCheckInterval),
      backInView(page)
    ).pipe(
      Effect.andThen(isCompleted),
      Effect.orElseSucceed(() => false),
      Effect.repeat({ until: (completed) => completed })
    );
    const signedIn = yield* ask.pipe(
      Effect.timeoutOption(Duration.millis(Math.max(0, until - now))),
      Effect.map(Option.isSome)
    );
    if (signedIn) {
      yield* Effect.sync(() => {
        forgetSignIn();
        page.close();
      });
    }
    return signedIn;
  });
