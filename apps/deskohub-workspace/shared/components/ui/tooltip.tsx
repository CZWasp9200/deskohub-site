"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  type ComponentProps,
  createContext,
  type RefObject,
  use,
  useRef,
  useState,
} from "react";
import { cn } from "@/shared/utils";

type TooltipTouchTap = {
  readonly open: boolean;
  /** Open state the trigger's current touch tap settles on, if one is underway. */
  readonly tapOpen: RefObject<boolean | undefined>;
  readonly setOpen: (open: boolean) => void;
};

const TooltipTouchTapContext = createContext<TooltipTouchTap | null>(null);

const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Radix opens a tooltip on the focus a touch tap emulates and closes it on the
 * tap's click, so on touchscreens it only flashes. A touch tap on the trigger
 * toggles the tooltip instead; outside taps, scrolling, and Escape dismiss it.
 */
function Tooltip({
  defaultOpen = false,
  onOpenChange,
  open: openProp,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const tapOpen = useRef<boolean | undefined>(undefined);
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <TooltipTouchTapContext value={{ open, setOpen, tapOpen }}>
      <TooltipPrimitive.Root
        {...props}
        onOpenChange={(nextOpen) => {
          if (tapOpen.current === undefined) setOpen(nextOpen);
        }}
        open={open}
      />
    </TooltipTouchTapContext>
  );
}

function TooltipTrigger({
  onClick,
  onPointerCancel,
  onPointerDown,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const touchTap = use(TooltipTouchTapContext);
  if (!touchTap) throw new Error("TooltipTrigger must be used within Tooltip");

  return (
    <TooltipPrimitive.Trigger
      {...props}
      onClick={(event) => {
        onClick?.(event);
        const tapOpen = touchTap.tapOpen.current;
        if (tapOpen === undefined) return;
        touchTap.setOpen(tapOpen);
        // Radix's own click handler runs after this one and must stay ignored.
        queueMicrotask(() => {
          touchTap.tapOpen.current = undefined;
        });
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        touchTap.tapOpen.current = undefined;
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.pointerType === "touch") {
          touchTap.tapOpen.current = !touchTap.open;
        }
      }}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-xl border border-navy-blue/12 bg-white px-3 py-2 text-sm text-navy-blue shadow-lg outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-tooltip-content-transform-origin)",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
