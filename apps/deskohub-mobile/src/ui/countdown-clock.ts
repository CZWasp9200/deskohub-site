/** Whole seconds as a short countdown, `m:ss` (`0:28`, `1:00`, `12:05`). */
export const countdownClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
