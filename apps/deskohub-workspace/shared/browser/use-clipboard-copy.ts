"use client";

import { useEffect, useRef, useState } from "react";

/** The outcome of the latest copy, until it resets. */
export type ClipboardCopyStatus = "idle" | "copied" | "failed";

/**
 * Copies text to the clipboard and reports the outcome for `resetAfterMs`,
 * long enough to show it next to the control, then returns to `idle`.
 */
export function useClipboardCopy(resetAfterMs = 2000) {
  const [status, setStatus] = useState<ClipboardCopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async (text: string): Promise<ClipboardCopyStatus> => {
    const outcome = await writeClipboardText(text);
    setStatus(outcome);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), resetAfterMs);
    return outcome;
  };

  return { status, copy };
}

const writeClipboardText = async (
  text: string
): Promise<Exclude<ClipboardCopyStatus, "idle">> => {
  if (!navigator.clipboard?.writeText) return "failed";
  return navigator.clipboard.writeText(text).then(
    () => "copied",
    () => "failed"
  );
};
