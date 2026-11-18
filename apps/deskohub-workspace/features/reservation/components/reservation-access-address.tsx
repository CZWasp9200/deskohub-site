"use client";

import { Copy, MapPin } from "lucide-react";
import { type Locale, m } from "@/features/i18n";
import { useClipboardCopy } from "@/shared/browser/use-clipboard-copy";
import { Button } from "@/shared/components/ui/button";
import { Toast } from "@/shared/components/ui/toast";
import { UnstyledButton } from "@/shared/components/ui/unstyled-button";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";

/**
 * The workspace address an invited person needs to arrive: tapping it copies
 * it and confirms with a toast, and "Open route" opens directions.
 */
export function ReservationAccessAddress({ locale }: { locale: Locale }) {
  const clipboard = useClipboardCopy(3000);

  return (
    <div
      className="mt-8 flex flex-col items-center gap-5 border-t border-navy-blue/12 pt-7 sm:mt-10"
      data-reservation-access-address=""
    >
      <UnstyledButton
        aria-label={m.reservationAccessGuestCopyAddress(
          { address: workspaceFormattedAddress },
          { locale }
        )}
        className="text-balance text-center text-lg font-semibold text-navy-blue focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burned-orange sm:text-xl"
        onClick={() => void clipboard.copy(workspaceFormattedAddress)}
      >
        {workspaceFormattedAddress}
        <Copy
          aria-hidden="true"
          className={
            clipboard.status === "copied"
              ? "ml-2 inline-block size-5 align-[-0.15em] text-aquamarine-ink"
              : "ml-2 inline-block size-5 align-[-0.15em] text-navy-blue/55"
          }
        />
      </UnstyledButton>
      <Button asChild caps shape="pill" size="lg" variant="secondary">
        <a href={workspaceGoogleDirectionsUrl} rel="noreferrer" target="_blank">
          <MapPin aria-hidden="true" className="size-5" />
          {m.reservationAccessGuestOpenRoute({}, { locale })}
        </a>
      </Button>
      <Toast open={clipboard.status === "copied"}>
        {m.reservationAccessGuestAddressCopied({}, { locale })}
      </Toast>
    </div>
  );
}
