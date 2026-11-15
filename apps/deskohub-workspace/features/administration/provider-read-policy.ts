import { Data, Effect } from "effect";
import { unstable_rethrow } from "next/navigation";

/** The Dotypos data a list export can't do without. */
type AdministrationListSource =
  | "booking-dates"
  | "booking-details"
  | "customer-details";

/**
 * A list export couldn't read Dotypos details its rows need. Pages show such
 * details as unavailable instead; an export fails rather than leave them out.
 */
export class AdministrationListSourceUnavailableError extends Data.TaggedError(
  "AdministrationListSourceUnavailableError"
)<{
  readonly source: AdministrationListSource;
  readonly cause: unknown;
}> {}

type ProviderReadFailure = {
  /** What a failed read logs beside the cause, such as its date range. */
  readonly annotations?: Readonly<Record<string, string | undefined>>;
  readonly cause: unknown;
  /** The warning a degrading read logs. */
  readonly message: string;
  readonly source: AdministrationListSource;
};

/**
 * How a list read treats a failed Dotypos read. A page degrades: it logs and
 * shows the details as unavailable. An export fails fast with
 * `AdministrationListSourceUnavailableError`. A read that succeeds without some
 * record isn't a failure under either.
 */
export type ProviderReadPolicy<E> = {
  /** Whether a failed read degrades or fails, so a batched read can recover each batch on its own. */
  readonly kind: "degrade" | "fail";
  readonly recover: <A>(
    failure: ProviderReadFailure,
    fallback: A
  ) => Effect.Effect<A, E>;
};

export const degradeProviderRead: ProviderReadPolicy<never> = {
  kind: "degrade",
  recover: ({ annotations, cause, message }, fallback) =>
    Effect.logWarning(message, { cause, ...annotations }).pipe(
      Effect.as(fallback)
    ),
};

export const failProviderRead: ProviderReadPolicy<AdministrationListSourceUnavailableError> =
  {
    kind: "fail",
    recover: ({ cause, source }) =>
      Effect.fail(
        new AdministrationListSourceUnavailableError({ cause, source })
      ),
  };

export const recoverProviderRead =
  <A, E>(
    policy: ProviderReadPolicy<E>,
    failure: Omit<ProviderReadFailure, "cause">,
    fallback: A
  ) =>
  (cause: unknown) => {
    unstable_rethrow(cause);
    return policy.recover({ ...failure, cause }, fallback);
  };
