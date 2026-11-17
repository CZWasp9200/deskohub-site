"use client";

import { type MouseEvent, type ReactNode, useId, useState } from "react";
import type { Locale } from "@/features/i18n";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { Sheet, SheetContent } from "@/shared/components/ui/sheet";
import { AgentBookingPickerContent } from "./agent-booking-picker-content";

/** Below Tailwind's `sm` breakpoint the picker opens as a bottom sheet. */
const phoneMedia = "(width < 40rem)";

type PickerLayout = "dialog" | "sheet";

/** What every opener of the picker spreads onto its button. */
export type AgentBookingPickerOpener = {
  readonly "aria-expanded": boolean;
  readonly "aria-haspopup": "dialog";
  readonly "data-agent-booking-opener": string;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * Opens the agent booking picker from the buttons `children` renders: a
 * dialog on wider screens and a bottom sheet on phones. The layout is chosen
 * when it opens and kept until it has closed, so a resize never swaps it
 * mid-way. Closing returns focus to the opener used, or to another opener
 * when a resize has hidden that one.
 */
export function AgentBookingPicker({
  children,
  locale,
}: {
  children: (opener: AgentBookingPickerOpener) => ReactNode;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<PickerLayout>("dialog");
  const [usedOpener, setUsedOpener] = useState<HTMLElement | null>(null);
  const openerId = useId();

  const contentProps = {
    "aria-describedby": undefined,
    locale,
    // Without a Radix trigger, focus goes back to an opener by hand.
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const openers = document.querySelectorAll<HTMLElement>(
        `[data-agent-booking-opener="${CSS.escape(openerId)}"]`
      );
      [usedOpener, ...openers]
        .find((opener) => opener?.isConnected && isShown(opener))
        ?.focus();
    },
  };

  return (
    <>
      {children({
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "data-agent-booking-opener": openerId,
        onClick: (event) => {
          setUsedOpener(event.currentTarget);
          setLayout(window.matchMedia(phoneMedia).matches ? "sheet" : "dialog");
          setOpen(true);
        },
      })}
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

/** Whether the element is rendered, so focus can land on it. */
const isShown = (element: HTMLElement) =>
  element.checkVisibility?.() ?? element.getClientRects().length > 0;
