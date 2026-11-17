"use client";

import { Slot } from "@radix-ui/react-slot";
import { type ReactElement, useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { Sheet, SheetContent } from "@/shared/components/ui/sheet";
import { AgentBookingPickerContent } from "./agent-booking-picker-content";

/** Below Tailwind's `sm` breakpoint the picker opens as a bottom sheet. */
const phoneMedia = "(width < 40rem)";

type PickerLayout = "dialog" | "sheet";

/**
 * Opens the agent booking picker from `children`, its only opener: a dialog
 * on wider screens and a bottom sheet on phones. The layout is chosen when
 * it opens and kept until it has closed, so a resize never swaps it mid-way.
 */
export function AgentBookingPicker({
  children,
  locale,
}: {
  children: ReactElement;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<PickerLayout>("dialog");
  const opener = useRef<HTMLElement>(null);

  const contentProps = {
    "aria-describedby": undefined,
    locale,
    // Without a Radix trigger, focus goes back to the opener by hand.
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      opener.current?.focus();
    },
  };

  return (
    <>
      <Slot
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setLayout(window.matchMedia(phoneMedia).matches ? "sheet" : "dialog");
          setOpen(true);
        }}
        ref={opener}
      >
        {children}
      </Slot>
      {
        {
          dialog: (
            <Dialog onOpenChange={setOpen} open={open}>
              <DialogContent
                {...contentProps}
                className="max-w-xl rounded-[1.375rem] border-white/20 bg-[#fbf8f3] p-7"
              >
                <AgentBookingPickerContent locale={locale} />
              </DialogContent>
            </Dialog>
          ),
          sheet: (
            <Sheet onOpenChange={setOpen} open={open}>
              <SheetContent
                {...contentProps}
                className="rounded-t-3xl border-0 bg-[#fbf8f3] px-4.5 pb-[max(1.625rem,env(safe-area-inset-bottom))]"
                onSwipeDismiss={() => setOpen(false)}
                side="bottom"
              >
                <AgentBookingPickerContent locale={locale} />
              </SheetContent>
            </Sheet>
          ),
        }[layout]
      }
    </>
  );
}
