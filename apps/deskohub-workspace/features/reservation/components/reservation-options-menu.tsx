"use client";

import { EllipsisVertical } from "lucide-react";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/utils";

/**
 * The ⋮ menu of a reservation: actions the customer rarely needs, kept out
 * of the card. For now its one item starts withdrawal from the contract.
 */
export function ReservationOptionsMenu({
  className,
  defaultOpen,
  locale,
  withdrawalHref,
}: {
  readonly className?: string;
  /** Design preview only: render the menu open. */
  readonly defaultOpen?: boolean;
  readonly locale: Locale;
  readonly withdrawalHref: string | undefined;
}) {
  if (!withdrawalHref) return null;

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={m.reservationOptionsMenuLabel({}, { locale })}
          className={cn("shrink-0 text-[#475569]", className)}
          data-reservation-options-trigger=""
          size="icon"
          type="button"
          variant="ghost"
        >
          <EllipsisVertical aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52 rounded-xl border-[#dfe4ec] p-1.5 shadow-[0_18px_40px_-20px_rgba(0,2,79,0.35)]"
      >
        <DropdownMenuItem
          asChild
          className="rounded-lg px-3 py-2.5 font-semibold text-rose-700 data-[highlighted]:bg-rose-50 data-[highlighted]:text-rose-800"
        >
          <GuardedLink href={withdrawalHref}>
            {m.reservationWithdrawalAction({}, { locale })}
          </GuardedLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
