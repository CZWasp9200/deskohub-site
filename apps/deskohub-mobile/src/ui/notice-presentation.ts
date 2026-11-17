export type NoticeTone = "info" | "positive" | "warning" | "error";

/**
 * How a notice presents its message: `error` interrupts (`alert`), the
 * other tones wait their turn (`status`). Without a message the live region
 * stays mounted, so assistive tech announces the next one, but takes no
 * layout space. A title is announced with the message, before it.
 */
export const noticePresentation = (
  tone: NoticeTone,
  message: string | undefined,
  title?: string
) => {
  const alert = tone === "error";
  const shown = message !== undefined && message !== "";
  return {
    shown,
    role: alert ? "alert" : "status",
    live: alert ? "assertive" : "polite",
    announcement: shown
      ? [title, message].filter((part) => !!part).join("\n")
      : undefined,
  } as const;
};

/**
 * An idle live region's layout: absolutely positioned, so it leaves the
 * parent's flow and its `gap`, which still applies between zero-size
 * children, and clipped to a point so its empty line draws nothing.
 */
export const idleLiveRegionLayout = {
  height: 1,
  overflow: "hidden",
  position: "absolute",
  width: 1,
} as const;
