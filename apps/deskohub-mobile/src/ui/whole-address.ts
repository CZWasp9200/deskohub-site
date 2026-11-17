/** U+2011, drawn like a hyphen but never broken after. */
const nonBreakingHyphen = "‑";

/**
 * An email address as running text shows it: whole on one line, the line
 * breaking before it rather than inside it (the owner's rule for addresses,
 * 2026-11-10). A hyphen is the only place a line breaker splits an address,
 * so each becomes a non-breaking hyphen that looks the same.
 */
export const wholeAddress = (address: string): string =>
  address.replaceAll("-", nonBreakingHyphen);
