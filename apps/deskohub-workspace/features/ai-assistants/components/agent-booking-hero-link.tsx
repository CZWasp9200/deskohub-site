"use client";

import { type Locale, m } from "@/features/i18n";
import Sparkle from "@/shared/components/icons/sparkle";
import { cn } from "@/shared/utils";
import { AgentBookingPicker } from "./agent-booking-picker";

/** The hero's offer to hand the reservation to an AI assistant. */
export function AgentBookingHeroLink({
  className,
  locale,
}: {
  className?: string;
  locale: Locale;
}) {
  return (
    <AgentBookingPicker locale={locale}>
      {(opener) => (
        <button
          {...opener}
          className={cn(
            "group inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-3xl bg-white/8 px-3.5 py-1.5 text-left text-[0.9375rem] text-white ring-1 ring-white/18 ring-inset transition-colors hover:bg-white/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange sm:px-4 sm:py-2 sm:text-[1.0625rem]",
            className
          )}
          type="button"
        >
          <Sparkle className="size-4.5 shrink-0 text-sunset-yellow" />
          <span className="border-b border-sunset-yellow/60 text-balance transition-colors group-hover:border-sunset-yellow">
            {m.agentBookingHeroLink({}, { locale })}
          </span>
        </button>
      )}
    </AgentBookingPicker>
  );
}
