"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { baseLocale, type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

interface SheetOverlayProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay> {
  ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Overlay>>;
}

function SheetOverlay({ className, ref, ...props }: SheetOverlayProps) {
  return (
    <SheetPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-navy-blue/70 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  );
}

const sheetVariants = cva(
  "fixed z-50 bg-white p-6 shadow-xl transition data-[state=closed]:animate-out data-[state=open]:animate-in",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b border-navy-blue/10 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t border-navy-blue/10 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-4/5 max-w-sm border-r border-navy-blue/10 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
        right:
          "inset-y-0 right-0 h-full w-4/5 max-w-sm border-l border-navy-blue/10 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  locale?: Locale;
  /**
   * Lets a bottom sheet be swiped down from a grab handle at its top edge,
   * which calls this to close it. Escape, the close button and the overlay
   * still close it as before.
   */
  onSwipeDismiss?: () => void;
  ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Content>>;
}

function SheetContent({
  side = "right",
  className,
  children,
  locale = baseLocale,
  onSwipeDismiss,
  ref,
  style,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPanel
        className={className}
        locale={locale}
        onSwipeDismiss={onSwipeDismiss}
        ref={ref}
        side={side}
        style={style}
        {...props}
      >
        {children}
      </SheetPanel>
    </SheetPortal>
  );
}

/**
 * The sheet itself. The portal mounts it only while the sheet is open, so a
 * swipe's state starts fresh on every opening.
 */
function SheetPanel({
  side = "right",
  className,
  children,
  locale = baseLocale,
  onSwipeDismiss,
  ref,
  style,
  ...props
}: SheetContentProps) {
  const swipe = useSwipeDownDismiss(onSwipeDismiss);
  const swipeable = side === "bottom" && onSwipeDismiss !== undefined;

  return (
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        sheetVariants({ side }),
        swipeable && swipe.dismissing && "data-[state=closed]:animate-none",
        className
      )}
      style={swipeable ? { ...style, ...swipe.style } : style}
      {...props}
    >
      {swipeable && (
        <div
          aria-hidden
          className="-mt-6 mb-2 flex cursor-grab touch-none justify-center pt-2.5 pb-3 active:cursor-grabbing"
          {...swipe.handle}
        >
          <span className="h-1.25 w-10 rounded-full bg-navy-blue/15" />
        </div>
      )}
      {children}
      <Button
        asChild
        className="absolute right-3 top-3"
        size="icon-sm"
        tone="muted"
        variant="ghost"
      >
        <SheetPrimitive.Close>
          <X aria-hidden className="size-4" />
          <span className="sr-only">{m.closeDialogLabel({}, { locale })}</span>
        </SheetPrimitive.Close>
      </Button>
    </SheetPrimitive.Content>
  );
}

/** How far, or how fast, a swipe must travel to dismiss the sheet. */
const swipeDismissDistance = 96;
const swipeDismissMinimumDistance = 24;
const swipeDismissVelocity = 0.5;
const swipeSlideOutMs = 200;

/**
 * Follows a pointer dragged down from the sheet's grab handle. Released past
 * the distance, or flicked, the sheet slides out of view and then calls
 * `onDismiss` with its exit animation off, so it doesn't jump back to slide
 * out again; otherwise it springs back.
 */
function useSwipeDownDismiss(onDismiss: (() => void) | undefined) {
  const [offset, setOffset] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [dismissing, setDismissing] = React.useState(false);
  const start = React.useRef<{ y: number; time: number } | null>(null);
  const slideOut = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => () => clearTimeout(slideOut.current), []);

  const end = () => {
    start.current = null;
    setDragging(false);
  };

  return {
    dismissing,
    style: {
      transform: dismissing ? "translateY(100%)" : `translateY(${offset}px)`,
      transition: dragging ? "none" : `transform ${swipeSlideOutMs}ms ease-out`,
    } satisfies React.CSSProperties,
    handle: {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || dismissing) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, time: event.timeStamp };
        setDragging(true);
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        if (start.current)
          setOffset(Math.max(0, event.clientY - start.current.y));
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        const swipe = start.current;
        end();
        if (!swipe) return;
        const distance = Math.max(0, event.clientY - swipe.y);
        const velocity = distance / Math.max(1, event.timeStamp - swipe.time);
        const dismissed =
          distance >= swipeDismissDistance ||
          (distance >= swipeDismissMinimumDistance &&
            velocity >= swipeDismissVelocity);
        if (!dismissed) return setOffset(0);
        setDismissing(true);
        slideOut.current = setTimeout(() => onDismiss?.(), swipeSlideOutMs);
      },
      onPointerCancel: () => {
        end();
        setOffset(0);
      },
    },
  };
}

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-2 text-left", className)} {...props} />
);

interface SheetTitleProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title> {
  ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Title>>;
}

function SheetTitle({ className, ref, ...props }: SheetTitleProps) {
  return (
    <SheetPrimitive.Title
      ref={ref}
      className={cn("text-lg text-navy-blue", className)}
      {...props}
    />
  );
}

interface SheetDescriptionProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description> {
  ref?: React.Ref<React.ComponentRef<typeof SheetPrimitive.Description>>;
}

function SheetDescription({ className, ref, ...props }: SheetDescriptionProps) {
  return (
    <SheetPrimitive.Description
      ref={ref}
      className={cn("text-sm text-navy-blue/75", className)}
      {...props}
    />
  );
}

SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;
SheetContent.displayName = SheetPrimitive.Content.displayName;
SheetHeader.displayName = "SheetHeader";
SheetTitle.displayName = SheetPrimitive.Title.displayName;
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
