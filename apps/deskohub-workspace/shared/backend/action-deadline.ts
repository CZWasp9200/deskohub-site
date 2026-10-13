import { Duration } from "effect";

/** Database, pricing, and other in-process work besides provider requests. */
const actionOverhead = Duration.seconds(10);

/**
 * The deadline of an action whose provider requests run as `phases`, one
 * after another. Each phase is the longest its slowest request may take;
 * requests that run in parallel share one phase. A Dotypos or Nexi request
 * counts one attempt's timeout, a Google Calendar load its retried worst case.
 */
export const getActionDeadline = (phases: readonly Duration.Duration[]) =>
  phases.reduce(
    (deadline, phase) => Duration.sum(deadline, phase),
    actionOverhead
  );

/**
 * Vercel's default Fluid compute function duration of 300 seconds, less room
 * for a cold start and the response. An action whose page sets no
 * `maxDuration` must reach its deadline before this.
 */
export const actionDeadlineCeiling = Duration.seconds(285);
