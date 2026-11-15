import { color, shadow, space } from "./tokens";

/** A confirmation of a completed action (green, with a check) or a neutral message (navy). */
export type ToastTone = "confirmation" | "neutral";

export interface ToastRequest {
  readonly message: string;
  readonly tone?: ToastTone;
  /** One optional action, such as Undo; pressing it also dismisses the toast. */
  readonly action?: { readonly label: string; readonly onPress: () => void };
}

export interface ShownToast extends ToastRequest {
  readonly tone: ToastTone;
  /** Tells a toast from the one it replaced, so a stale timer can't dismiss it. */
  readonly id: number;
}

export interface ToastState {
  readonly shown: ShownToast | undefined;
  readonly lastId: number;
}

export type ToastEvent =
  | { readonly kind: "show"; readonly request: ToastRequest }
  | { readonly kind: "dismiss"; readonly id: number };

export const noToast: ToastState = { shown: undefined, lastId: 0 };

/** How long a toast stays up on its own. */
export const toastDurationMs = 4000;

/**
 * The toast after `event`: a new toast replaces the current one; a dismissal
 * clears only the toast it names, so a replaced toast's timer or a late
 * press can't dismiss its successor.
 */
export const toastAfter = (
  state: ToastState,
  event: ToastEvent
): ToastState => {
  if (event.kind === "show") {
    const id = state.lastId + 1;
    return {
      lastId: id,
      shown: {
        ...event.request,
        tone: event.request.tone ?? "confirmation",
        id,
      },
    };
  }
  return state.shown?.id === event.id ? { ...state, shown: undefined } : state;
};

/**
 * The toast's distance from the bottom of the screen: clear of the bottom
 * safe area and of the tallest bottom chrome a focused layout registered
 * (the tab bar or a sticky footer, whose height already includes the safe
 * area it sits on), plus a gap.
 */
export const toastBottomOffset = (
  safeAreaBottom: number,
  obstructions: Iterable<number>
): number => Math.max(safeAreaBottom, ...obstructions) + space.md;

/** The toast's fill, lift and whether it leads with the check icon. */
export const toastLook = (tone: ToastTone) =>
  tone === "confirmation"
    ? {
        backgroundColor: color.positiveInk,
        lift: shadow.toastConfirmation,
        checkIcon: true,
      }
    : { backgroundColor: color.navy, lift: shadow.toast, checkIcon: false };
