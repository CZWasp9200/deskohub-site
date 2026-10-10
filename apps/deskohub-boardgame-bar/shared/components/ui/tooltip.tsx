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
import { cn } from "@/shared/utils/index";

type TooltipTouchTap = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  /** Open state the trigger's latest touch press settles on when it taps. */
  readonly tapOpen: RefObject<boolean | undefined>;
  /** Whether Radix's close on the tap's click is being ignored. */
  readonly isApplyingTap: RefObject<boolean>;
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
  const isApplyingTap = useRef(false);
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <TooltipTouchTapContext value={{ isApplyingTap, open, setOpen, tapOpen }}>
      <TooltipPrimitive.Root
        {...props}
        onOpenChange={(nextOpen) => {
          if (!isApplyingTap.current) setOpen(nextOpen);
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
        touchTap.tapOpen.current = undefined;
        // Keyboard activation clicks report no detail and keep Radix's behavior.
        if (tapOpen === undefined || event.detail === 0) return;
        touchTap.setOpen(tapOpen);
        // Radix's own click handler runs after this one in the same dispatch.
        touchTap.isApplyingTap.current = true;
        queueMicrotask(() => {
          touchTap.isApplyingTap.current = false;
        });
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        touchTap.tapOpen.current = undefined;
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        touchTap.tapOpen.current =
          event.pointerType === "touch" ? !touchTap.open : undefined;
      }}
    />
  );
}

const TooltipContent = ({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) => (
  <TooltipPrimitive.Content
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
      className
    )}
    {...props}
  />
);

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
