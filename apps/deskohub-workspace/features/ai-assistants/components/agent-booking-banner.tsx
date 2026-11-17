"use client";

import { ChevronRight } from "lucide-react";
import { type Locale, m } from "@/features/i18n";
import Sparkle from "@/shared/components/icons/sparkle";
import { Button } from "@/shared/components/ui/button";
import { AgentBookingPicker } from "./agent-booking-picker";

/**
 * The reservation page's offer to hand the reservation to an AI assistant:
 * a round arrow button on phones, a labelled one on wider screens. The
 * button is a pill inset by the banner's padding, so the banner's corner
 * radius is the button's plus that padding.
 */
export function AgentBookingBanner({ locale }: { locale: Locale }) {
  return (
    <div className="flex items-center gap-3 rounded-[1.875rem] bg-[#fbf8f3] py-2 pr-2 pl-4.5 text-navy-blue ring-1 ring-white/20 sm:gap-3.5 sm:rounded-[2.125rem] sm:py-2.5 sm:pr-2.5 sm:pl-5.5">
      <Sparkle className="size-4.5 shrink-0 text-sunset-yellow" />
      <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug sm:text-base">
        <span className="sm:hidden">
          {m.agentBookingBannerShortText({}, { locale })}
        </span>
        <span className="max-sm:hidden">
          {m.agentBookingBannerText({}, { locale })}
        </span>
      </p>
      <AgentBookingPicker locale={locale}>
        {(opener) => (
          <>
            <Button
              // biome-ignore lint/plugin: the picker's opener props are its state, ARIA and click handler, never a className.
              {...opener}
              aria-label={m.agentBookingChooseAssistant({}, { locale })}
              className="sm:hidden"
              shape="pill"
              size="icon-lg"
              tone="burned-orange"
              type="button"
            >
              <ChevronRight aria-hidden className="size-4.5" />
            </Button>
            <Button
              // biome-ignore lint/plugin: the picker's opener props are its state, ARIA and click handler, never a className.
              {...opener}
              caps
              className="max-sm:hidden"
              shape="pill"
              size="lg"
              tone="burned-orange"
              type="button"
            >
              {m.agentBookingChooseAssistant({}, { locale })}
              <ChevronRight aria-hidden className="size-4.5" />
            </Button>
          </>
        )}
      </AgentBookingPicker>
    </div>
  );
}
