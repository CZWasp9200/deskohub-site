import { EventEmitter } from "node:events";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Reports every connection the Workspace's pools release to Vercel's
 * `attachDatabasePool`, which reads it as a pg pool: after each release it
 * keeps the function instance awake for `idleTimeoutMillis` plus 100 ms, so
 * the pools close idle connections before the instance suspends instead of
 * leaving them open while it is frozen. One reporter serves every pool,
 * because Vercel keeps one wait per process and each release replaces it with
 * the releasing pool's timeout.
 */
export const attachDatabaseReleaseReporter = (idleCloseMillis: number) => {
  const releases = Object.assign(new EventEmitter(), {
    options: { idleTimeoutMillis: idleCloseMillis },
  });
  attachDatabasePool(releases);
  return () => {
    releases.emit("release");
  };
};
