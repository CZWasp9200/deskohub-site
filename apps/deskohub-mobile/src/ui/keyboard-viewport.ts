import { useEffect, useState } from "react";

/** The part of the page the on-screen keyboard leaves visible, in CSS px. */
export interface VisibleViewport {
  readonly height: number;
  /** How far the browser has panned the visible part down the page. */
  readonly offsetTop: number;
}

const resizesContent = "interactive-widget=resizes-content";

/** The viewport meta content with the keyboard resizing the layout. */
const withResizedContent = (content: string): string =>
  /interactive-widget=[^,\s]*/.test(content)
    ? content.replace(/interactive-widget=[^,\s]*/, resizesContent)
    : `${content}, ${resizesContent}`;

/**
 * Keeps a page's bottom action directly above the on-screen keyboard in a
 * browser, for as long as the calling screen is mounted.
 *
 * It asks the browser to shrink the layout viewport when the keyboard opens
 * (`interactive-widget=resizes-content` on the viewport meta, in place of any
 * other setting, which Android Chrome honours) and restores the meta on unmount, so only that screen
 * changes how the keyboard resizes the page. Where the browser ignores it and
 * only the visual viewport shrinks, the visible area it returns lets the
 * screen size itself to that area instead. Without a DOM (native) or while
 * the page is zoomed it returns nothing and the screen keeps its own size.
 */
export const useKeyboardResizedViewport = (): VisibleViewport | undefined => {
  const [viewport, setViewport] = useState<VisibleViewport>();

  useEffect(() => {
    const meta = globalThis.document?.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]'
    );
    const original = meta?.getAttribute("content") ?? undefined;
    if (meta && original !== undefined) {
      meta.setAttribute("content", withResizedContent(original));
    }

    const visual = globalThis.visualViewport;
    const follow = () => {
      if (!visual) return;
      setViewport(
        visual.scale === 1
          ? { height: visual.height, offsetTop: visual.offsetTop }
          : undefined
      );
    };
    follow();
    visual?.addEventListener("resize", follow);
    visual?.addEventListener("scroll", follow);

    return () => {
      visual?.removeEventListener("resize", follow);
      visual?.removeEventListener("scroll", follow);
      if (meta && original !== undefined) {
        meta.setAttribute("content", original);
      }
    };
  }, []);

  return viewport;
};
