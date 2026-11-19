import { KeyRound } from "lucide-react";
import Link from "next/link";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type { ReservationAccessViewModel } from "@/features/reservation/backend/reservation-access.service";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import { reservationStatusPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";
import { ReservationAccessAddress } from "./reservation-access-address";

type ReservationAccessPageProps = {
  readonly access: ReservationAccessViewModel;
  readonly locale: Locale;
  readonly orderId: string;
  readonly presentation?: "page" | "modal";
};

const formatAccessDay = (day: string, locale: Locale) =>
  Temporal.PlainDate.from(day).toLocaleString(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

function formatAccessWindow(
  access: Extract<ReservationAccessViewModel, { state: "available" }>,
  locale: Locale
) {
  const days = access.accessDays;
  if (!days) {
    return m.reservationAccessLead(
      {
        startsAt: formatReservationDisplayDateTime(
          access.accessStartsAt,
          locale
        ),
        endsAt: formatReservationDisplayDateTime(access.accessEndsAt, locale),
      },
      { locale }
    );
  }

  const startsOn = formatAccessDay(days.from, locale);
  return days.from === days.through
    ? m.reservationAccessDatesSingle({ date: startsOn }, { locale })
    : m.reservationAccessDatesRange(
        { startsOn, endsOn: formatAccessDay(days.through, locale) },
        { locale }
      );
}

export function ReservationAccessPage({
  access,
  locale,
  orderId,
  presentation = "page",
}: ReservationAccessPageProps) {
  const isGuest =
    access.state !== "invalid_link" && access.viewer === "invitee";
  const bookerName =
    access.state === "available" ? access.bookedBy?.name : undefined;
  const title = {
    available: m.reservationAccessTitle({}, { locale }),
    invalid_link: m.reservationAccessInvalidLinkTitle({}, { locale }),
    unavailable: m.reservationAccessUnavailableTitle({}, { locale }),
  }[access.state];
  const reservationStatusHref = `/${locale}${reservationStatusPath}/${encodeURIComponent(orderId)}`;

  const content = (
    <section
      className={
        presentation === "modal"
          ? "bg-white text-navy-blue"
          : "overflow-hidden rounded-[2.25rem] border border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm"
      }
      data-reservation-access=""
    >
      <div className="p-6 sm:p-10">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-ink ring-8 ring-aquamarine-green/8 sm:h-16 sm:w-16">
            <KeyRound className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-balance text-[1.75rem] leading-none sm:text-5xl">
              {title}
            </h1>
            {isGuest && (
              <p
                className="mt-3 text-lg text-navy-blue/70 sm:text-xl"
                data-reservation-access-booked-by=""
              >
                {bookerName
                  ? m.reservationAccessGuestBookedBy(
                      {
                        product: getWorkspaceOfficeProductTitle(locale),
                        name: bookerName,
                      },
                      { locale }
                    )
                  : getWorkspaceOfficeProductTitle(locale)}
              </p>
            )}
            {access.state === "invalid_link" && (
              <p className="mt-5 text-lg leading-8 text-navy-blue/70">
                {m.reservationAccessInvalidLinkLead({}, { locale })}
              </p>
            )}
            {access.state === "unavailable" && (
              <p className="mt-5 text-lg leading-8 text-navy-blue/70">
                {m.reservationAccessUnavailableLead({}, { locale })}
              </p>
            )}
          </div>
        </div>

        {access.state === "available" && (
          <div className="mt-10 sm:mt-12">
            <output
              aria-label={Array.from(access.code).join(" ")}
              className="flex flex-wrap justify-center gap-[clamp(0.25rem,1.5vw,0.75rem)]"
              data-ph-mask=""
              data-ph-no-capture=""
              data-reservation-access-code=""
            >
              {Array.from(access.code).map((character, index) => (
                <span
                  aria-hidden="true"
                  className="grid h-[clamp(3.75rem,16vw,5.75rem)] w-[clamp(1.5rem,7.5vw,4rem)] place-items-center rounded-xl bg-navy-blue/5 font-mono text-[clamp(1.35rem,6vw,2.6rem)] font-medium tabular-nums text-navy-blue"
                  // biome-ignore lint/suspicious/noArrayIndexKey: Access-code characters are positional and may repeat.
                  key={`${index}-${character}`}
                >
                  {character}
                </span>
              ))}
            </output>

            <p className="mt-10 text-center font-mono text-sm text-navy-blue/60 sm:mt-14">
              {formatAccessWindow(access, locale)}
            </p>
          </div>
        )}

        {isGuest ? (
          <ReservationAccessAddress locale={locale} />
        ) : (
          <div className="mt-8 flex justify-center sm:mt-10">
            <Button asChild variant="secondary" size="lg">
              <Link href={reservationStatusHref} prefetch={false}>
                {m.checkoutStatusSummaryTitle({}, { locale })}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );

  return presentation === "modal" ? (
    content
  ) : (
    <CheckoutFlowLayout
      activeStepKey="complete"
      locale={locale}
      // An invited person never went through checkout, so the page shows no steps.
      steps={isGuest ? false : undefined}
    >
      {content}
    </CheckoutFlowLayout>
  );
}
