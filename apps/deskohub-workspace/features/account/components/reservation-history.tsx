import type { ReactNode } from "react";
import { CalendarDays, UserRound, Users } from "lucide-react";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type {
  CustomerReservationHistory,
  CustomerReservationParty,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "@/features/account/contracts";
import { getReservationProductName } from "@/features/account/reservation-product-name";
import { type Locale, m } from "@/features/i18n";
import { ReservationAccessButton } from "@/features/reservation/components/reservation-access-button";
import { ReservationOptionsMenu } from "@/features/reservation/components/reservation-options-menu";
import { formatMeetingRoomSetupStart } from "@/features/reservation/meeting-room-reservation-display-time";
import {
  formatReservationDisplayDateRange,
  formatReservationDisplayDateTimeRange,
} from "@/features/reservation/reservation-date";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { isMidnight } from "@/shared/utils/temporal";

const getStatusLabel = (status: CustomerReservationStatus, locale: Locale) => {
  switch (status) {
    case "cancelled":
      return m.accountReservationStatusCancelled({}, { locale });
    case "confirmed":
      return m.accountReservationStatusConfirmed({}, { locale });
    case "pending":
      return m.accountReservationStatusPending({}, { locale });
    case "requires-attention":
      return m.accountReservationStatusAttention({}, { locale });
  }
};

const getReservationPartyLabel = (
  party: CustomerReservationParty,
  locale: Locale
) => {
  switch (party.kind) {
    case "booked-for":
      return party.customerName
        ? m.accountReservationBookedFor(
            { name: party.customerName },
            { locale }
          )
        : m.accountReservationBookedForSomeoneElse({}, { locale });
    case "booked-by":
      return party.authorName
        ? m.accountReservationBookedBy({ name: party.authorName }, { locale })
        : m.accountReservationBookedByAnotherAccount({}, { locale });
    case "booked-by-deleted-account":
      return m.accountReservationBookedByDeletedAccount({}, { locale });
  }
};

const getReservationStatusTone = (
  status: CustomerReservationStatus
): StatusTone => {
  switch (status) {
    case "confirmed":
      return "positive";
    case "cancelled":
      return "neutral";
    case "requires-attention":
      return "attention";
    case "pending":
      return "progress";
  }
};

const formatReservationPeriod = (
  reservation: CustomerReservationSummary,
  locale: Locale
) => {
  if (!reservation.startsAt || !reservation.endsAt) return null;
  const start = new Date(reservation.startsAt);
  const end = new Date(reservation.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const startInstant = Temporal.Instant.fromEpochMilliseconds(start.getTime());
  const endInstant = Temporal.Instant.fromEpochMilliseconds(end.getTime());
  if (end.getTime() > start.getTime()) {
    if (
      isMidnight(
        startInstant
          .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
          .toPlainDateTime()
      ) &&
      isMidnight(
        endInstant
          .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
          .toPlainDateTime()
      )
    ) {
      return formatReservationDisplayDateRange(
        startInstant,
        endInstant,
        locale
      );
    }
  }
  return formatReservationDisplayDateTimeRange(
    startInstant,
    endInstant,
    locale
  );
};

/** The setup start of a meeting room booked with early setup. */
const formatReservationSetupStart = (
  reservation: CustomerReservationSummary,
  locale: Locale
) =>
  reservation.setupStartsAt && reservation.startsAt
    ? m.accountReservationSetupFrom(
        {
          time: formatMeetingRoomSetupStart(
            {
              setupStart: Temporal.Instant.from(reservation.setupStartsAt),
              bookedStart: Temporal.Instant.from(reservation.startsAt),
            },
            locale
          ),
        },
        { locale }
      )
    : null;

const formatReservationDateTile = (startsAt: string | null, locale: Locale) => {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? { day, month } : null;
};

const getReservationHref = (
  locale: Locale,
  workspaceReservationId: NonNullable<
    CustomerReservationSummary["workspaceReservationId"]
  >
) =>
  `/${locale}${reservationStatusPath}/${encodeURIComponent(workspaceReservationId)}`;

/** The ⋮ menu of a reservation the customer can still withdraw from. */
function ReservationRowMenu({
  className,
  linkClassName,
  linkOnly,
  locale,
  reservation,
}: {
  readonly className?: string;
  readonly linkClassName?: string;
  readonly linkOnly?: boolean;
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  if (!reservation.withdrawal?.eligible || !reservation.workspaceReservationId)
    return null;
  return (
    <ReservationOptionsMenu
      className={className}
      linkClassName={linkClassName}
      linkOnly={linkOnly}
      locale={locale}
      withdrawalHref={`${getReservationHref(locale, reservation.workspaceReservationId)}?withdraw=1`}
    />
  );
}

export function ReservationHistory({
  history,
  locale,
}: {
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
}) {
  if (history.kind === "unavailable") {
    return <ProviderUnavailableNotice locale={locale} />;
  }

  const { groups } = history;
  const hasUndatedReservations = groups.unavailable.length > 0;

  return (
    <div className="min-w-0 space-y-8">
      {groups.current.length > 0 && (
        <CurrentReservationGroup
          locale={locale}
          reservations={groups.current}
        />
      )}
      <PastReservationGroup locale={locale} reservations={groups.past} />
      {hasUndatedReservations && (
        <UndatedReservationGroup
          locale={locale}
          reservations={groups.unavailable}
        />
      )}
    </div>
  );
}

function CurrentReservationGroup({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  const [featuredReservation, ...additionalReservations] = reservations;
  if (!featuredReservation) return null;

  return (
    <AccountSectionPanel
      aria-labelledby="account-reservations-current-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="current"
      id="account-reservations-current"
      title={m.accountReservationsCurrentTitle({}, { locale })}
      titleId="account-reservations-current-title"
    >
      <ul className="m-0 min-w-0 list-none space-y-3 p-0">
        <FeaturedReservationItem
          locale={locale}
          reservation={featuredReservation}
        />
      </ul>

      {additionalReservations.length > 0 && (
        <div className="mt-7 min-w-0">
          <h3 className="mb-3 break-words text-sm font-semibold uppercase tracking-[0.12em] text-[#64748b]">
            {m.accountReservationMoreCurrent({}, { locale })}
          </h3>
          <ul className="m-0 min-w-0 list-none space-y-3 p-0">
            {additionalReservations.map((reservation) => (
              <CompactReservationItem
                key={reservation.id}
                locale={locale}
                reservation={reservation}
              />
            ))}
          </ul>
        </div>
      )}
    </AccountSectionPanel>
  );
}

function FeaturedReservationItem({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const period = formatReservationPeriod(reservation, locale);
  const setupStart = formatReservationSetupStart(reservation, locale);
  const title = getReservationProductName(reservation.product, locale);

  return (
    <li className="min-w-0">
      <Card className="min-w-0 overflow-hidden rounded-2xl border-[#e9b8a7] bg-white shadow-[0_18px_40px_-28px_rgba(0,2,79,0.35)]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 p-6 @4xl:py-4">
          <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-3">
            <StatusBadge
              className="max-w-full min-w-0 break-words whitespace-normal"
              data-account-reservation-status={reservation.status}
              tone={getReservationStatusTone(reservation.status)}
            >
              {getStatusLabel(reservation.status, locale)}
            </StatusBadge>
            <code className="min-w-0 max-w-full break-all font-mono text-sm text-[#64748b]">
              {reservation.id}
            </code>
          </div>
          <ReservationRowMenu
            className="-my-1.5 -mr-2"
            linkClassName="@max-3xl:hidden"
            locale={locale}
            reservation={reservation}
          />
        </div>

        <div className="border-t border-[#dfe4ec]" />

        <div className="grid min-w-0 gap-6 px-6 py-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,0.8fr)] @4xl:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {m.accountReservationProduct({}, { locale })}
            </p>
            <h3 className="mt-2 break-words text-xl font-semibold leading-tight tracking-[-0.02em] text-[#00024f]">
              {title}
            </h3>
            <p className="mt-3 flex min-w-0 items-center gap-2 break-words text-sm text-[#64748b]">
              <Users aria-hidden="true" className="size-4 shrink-0" />
              <span>
                {reservation.seats === null
                  ? m.accountFeatureUnavailable({}, { locale })
                  : m.accountReservationSeats(
                      { count: reservation.seats },
                      { locale }
                    )}
              </span>
            </p>
            {reservation.party && (
              <p className="mt-2 text-sm text-[#64748b]">
                <ReservationPartyNote
                  locale={locale}
                  party={reservation.party}
                />
              </p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              {m.accountReservationValidity({}, { locale })}
            </p>
            {period ? (
              <p className="mt-3 flex min-w-0 items-start gap-2 break-words text-sm leading-6 text-[#344258] @4xl:mt-2">
                <CalendarDays
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0"
                />
                <span>{period}</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-[#64748b]">
                {m.accountFeatureUnavailable({}, { locale })}
              </p>
            )}
            {setupStart && (
              <p className="mt-1 pl-6 text-sm text-[#64748b]">{setupStart}</p>
            )}
          </div>

          <ReservationOnSiteBox locale={locale} onSite={reservation.onSite} />
        </div>

        <div className="flex min-w-0 flex-col gap-3 border-t border-[#dfe4ec] p-6 @3xl:flex-row @3xl:items-center @3xl:justify-between @3xl:gap-4 @4xl:py-4">
          <ReservationRowMenu
            linkClassName="-mt-4 w-full text-center underline @3xl:hidden"
            linkOnly
            locale={locale}
            reservation={reservation}
          />
          {reservation.workspaceReservationId && (
            <div className="min-w-0 *:w-full @3xl:*:w-auto">
              <ReservationDetailLink
                locale={locale}
                reservation={reservation}
              />
            </div>
          )}
          <ReservationAccessButton
            className="@3xl:w-auto"
            href={
              reservation.workspaceReservationId && !reservation.reviewSandbox
                ? `/${locale}${reservationAccessPath}/${encodeURIComponent(reservation.workspaceReservationId)}`
                : undefined
            }
            locale={locale}
            unavailableNote={
              reservation.reviewSandbox
                ? m.accountReservationPinReviewSandbox({}, { locale })
                : m.accountReservationPinUnavailable({}, { locale })
            }
          />
        </div>
      </Card>
    </li>
  );
}

function OnSiteRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <dt className="min-w-0">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold text-[#00024f]">
        {children}
      </dd>
    </div>
  );
}

/**
 * The table and Wi-Fi of a confirmed booking, as its confirmation email
 * sends them. Rows without data are left out; nothing renders without both.
 */
function ReservationOnSiteBox({
  locale,
  onSite,
}: {
  readonly locale: Locale;
  readonly onSite: CustomerReservationSummary["onSite"];
}) {
  const table = onSite?.table;
  const network = onSite?.network;
  if (!table && !network) return null;

  return (
    <dl className="m-0 min-w-0 self-start rounded-xl bg-[#f6f8fa] p-4 text-sm leading-5 text-[#475569]">
      {table && (
        <OnSiteRow
          label={
            {
              assigned: m.accountReservationAssignedDesk({}, { locale }),
              shared: m.checkoutEmailTablesLabel({}, { locale }),
            }[table.mode]
          }
        >
          {table.name}
        </OnSiteRow>
      )}
      {network && (
        <div
          className={table ? "mt-3 border-t border-[#dfe4ec] pt-3" : undefined}
        >
          <dt className="font-semibold text-[#344258]">
            {m.accountReservationWifi({}, { locale })}
          </dt>
          <dd className="m-0 mt-2">
            <dl className="m-0 space-y-2">
              <div className="min-w-0">
                <dt>{m.checkoutEmailNetworkSsidLabel({}, { locale })}</dt>
                <dd className="m-0 break-words font-semibold text-[#00024f]">
                  {network.ssid}
                </dd>
              </div>
              <div className="min-w-0">
                <dt>{m.checkoutEmailNetworkPasswordLabel({}, { locale })}</dt>
                <dd className="m-0 select-all break-all font-mono font-semibold text-[#00024f]">
                  {network.password}
                </dd>
              </div>
            </dl>
          </dd>
        </div>
      )}
    </dl>
  );
}

function CompactReservationItem({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const dateTile = formatReservationDateTile(reservation.startsAt, locale);
  const period = formatReservationPeriod(reservation, locale);
  const setupStart = formatReservationSetupStart(reservation, locale);

  return (
    <li className="min-w-0">
      <article className="relative min-w-0 rounded-2xl border border-[#dfe4ec] bg-white p-4 shadow-[0_12px_30px_-24px_rgba(0,2,79,0.45)] @2xl:min-h-[74px]">
        <ReservationRowMenu
          linkClassName="absolute top-4 right-4 @2xl:hidden"
          linkOnly
          locale={locale}
          reservation={reservation}
        />
        <div className="flex min-w-0 flex-col gap-4 @2xl:flex-row @2xl:items-center">
          <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-[#dbe4ff] bg-[#f3f6ff] px-1 text-center text-[#344258]">
            <span className="sr-only">
              {m.accountReservationDate({}, { locale })}:{" "}
              {dateTile
                ? `${dateTile.month} ${dateTile.day}`
                : m.accountFeatureUnavailable({}, { locale })}
            </span>
            {dateTile ? (
              <>
                <span className="max-w-full break-words text-[10px] font-semibold uppercase leading-3 text-[#64748b]">
                  {dateTile.month}
                </span>
                <span className="text-lg font-bold leading-5 text-[#00024f]">
                  {dateTile.day}
                </span>
              </>
            ) : (
              <span className="break-words text-[10px] font-semibold uppercase leading-3 text-[#64748b]">
                {m.accountFeatureUnavailable({}, { locale })}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="sr-only">
              {m.accountReservationProduct({}, { locale })}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h4 className="break-words text-base font-semibold leading-5 text-[#00024f]">
                {getReservationProductName(reservation.product, locale)}
              </h4>
              <span className="sr-only">
                {m.accountReservationStatus({}, { locale })}:{" "}
              </span>
              <StatusBadge
                className="max-w-full min-w-0 break-words whitespace-normal"
                data-account-reservation-status={reservation.status}
                tone={getReservationStatusTone(reservation.status)}
              >
                {getStatusLabel(reservation.status, locale)}
              </StatusBadge>
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-[#64748b]">
              {period ? (
                <span className="inline-flex min-w-0 items-start gap-1.5 break-words">
                  <CalendarDays
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>{period}</span>
                </span>
              ) : (
                <span>
                  <span className="sr-only">
                    {m.accountReservationValidity({}, { locale })}:{" "}
                  </span>
                  {m.accountFeatureUnavailable({}, { locale })}
                </span>
              )}
              {setupStart && <span>{setupStart}</span>}
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-4 shrink-0" />
                <span>
                  {reservation.seats === null
                    ? m.accountFeatureUnavailable({}, { locale })
                    : m.accountReservationSeats(
                        { count: reservation.seats },
                        { locale }
                      )}
                </span>
              </span>
              {reservation.party && (
                <ReservationPartyNote
                  locale={locale}
                  party={reservation.party}
                />
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-stretch gap-1 @2xl:items-center">
            <ReservationRowMenu
              linkClassName="hidden w-full text-center underline @2xl:block"
              linkOnly
              locale={locale}
              reservation={reservation}
            />
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1 *:w-full @2xl:flex-none @2xl:*:w-auto">
                <ReservationDetailLink
                  locale={locale}
                  reservation={reservation}
                />
              </div>
              <ReservationRowMenu
                className="-mr-2"
                linkClassName="hidden"
                locale={locale}
                reservation={reservation}
              />
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

function PastReservationGroup({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <AccountSectionPanel
      actions={
        <span className="rounded-full bg-[#f3f5f8] px-2.5 py-1 text-xs font-semibold text-[#64748b]">
          {reservations.length}
        </span>
      }
      aria-labelledby="account-reservations-past-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="past"
      id="account-reservations-past"
      title={m.accountReservationsPastTitle({}, { locale })}
      titleId="account-reservations-past-title"
    >
      {reservations.length === 0 ? (
        <GroupEmptyNotice
          empty={m.accountReservationsPastEmpty({}, { locale })}
        />
      ) : (
        <PastReservationTable locale={locale} reservations={reservations} />
      )}
    </AccountSectionPanel>
  );
}

function PastReservationTable({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <CardContent className="min-w-0 overflow-hidden p-0">
      <table
        aria-labelledby="account-reservations-past-title"
        className="block w-full text-left @4xl:table"
      >
        <thead className="hidden border-b border-[#dfe4ec] text-xs font-semibold uppercase tracking-[0.1em] text-[#64748b] @4xl:table-header-group">
          <tr className="block @4xl:table-row">
            <th className="px-3 py-3" scope="col">
              {m.accountReservationDate({}, { locale })}
            </th>
            <th className="px-3 py-3" scope="col">
              {m.accountReservationProduct({}, { locale })}
            </th>
            <th className="px-3 py-3" scope="col">
              {m.accountReservationSeatsLabel({}, { locale })}
            </th>
            <th className="px-3 py-3" scope="col">
              {m.accountReservationStatus({}, { locale })}
            </th>
            <th className="px-3 py-3 text-right" scope="col">
              <span className="sr-only">
                {m.accountReservationView({}, { locale })}
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="block @4xl:table-row-group">
          {reservations.map((reservation) => (
            <tr
              className="block min-w-0 border-b border-[#dfe4ec] last:border-0 @max-4xl:p-4 @4xl:table-row"
              key={reservation.id}
            >
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm text-[#344258] @4xl:table-cell @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationDate({}, { locale })}
                  </span>
                  <span className="break-words">
                    {formatReservationPeriod(reservation, locale) ??
                      m.accountFeatureUnavailable({}, { locale })}
                    <PastReservationSetupStart
                      locale={locale}
                      reservation={reservation}
                    />
                  </span>
                </div>
              </td>
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm font-semibold text-[#344258] @4xl:table-cell @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationProduct({}, { locale })}
                  </span>
                  <span className="min-w-0 break-words">
                    {getReservationProductName(reservation.product, locale)}
                    {reservation.party && (
                      <span className="mt-1 block text-xs font-normal text-[#64748b]">
                        <ReservationPartyNote
                          locale={locale}
                          party={reservation.party}
                        />
                      </span>
                    )}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 break-words px-0 py-1 align-top text-sm text-[#344258] @4xl:table-cell @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationSeatsLabel({}, { locale })}
                  </span>
                  <span className="break-words">
                    {reservation.seats === null
                      ? m.accountFeatureUnavailable({}, { locale })
                      : m.accountReservationSeats(
                          { count: reservation.seats },
                          { locale }
                        )}
                  </span>
                </div>
              </td>
              <td className="block min-w-0 px-0 py-1 align-top text-sm text-[#344258] @4xl:table-cell @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 items-baseline justify-between gap-4 @4xl:block">
                  <span className="block shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b] @4xl:hidden">
                    {m.accountReservationStatus({}, { locale })}
                  </span>
                  <StatusBadge
                    className="max-w-full min-w-0 break-words whitespace-normal"
                    data-account-reservation-status={reservation.status}
                    tone={getReservationStatusTone(reservation.status)}
                  >
                    {getStatusLabel(reservation.status, locale)}
                  </StatusBadge>
                </div>
              </td>
              <td className="block min-w-0 px-0 pt-3 align-top text-right @4xl:table-cell @4xl:px-3 @4xl:py-4">
                <div className="flex min-w-0 justify-end">
                  <ReservationDetailLink
                    locale={locale}
                    presentation="text"
                    reservation={reservation}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent>
  );
}

function PastReservationSetupStart({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: CustomerReservationSummary;
}) {
  const setupStart = formatReservationSetupStart(reservation, locale);
  return (
    setupStart && (
      <span className="mt-1 block text-xs text-[#64748b]">{setupStart}</span>
    )
  );
}

function UndatedReservationGroup({
  locale,
  reservations,
}: {
  readonly locale: Locale;
  readonly reservations: readonly CustomerReservationSummary[];
}) {
  return (
    <section
      aria-labelledby="account-reservations-unavailable-title"
      className="min-w-0 scroll-mt-8"
      data-account-reservation-group="unavailable"
      id="account-reservations-unavailable"
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <h3
          className="min-w-0 break-words text-sm font-semibold uppercase tracking-[0.12em] text-[#64748b]"
          id="account-reservations-unavailable-title"
        >
          {m.accountReservationsOtherTitle({}, { locale })}
        </h3>
        <span className="shrink-0 rounded-full bg-[#f3f5f8] px-2.5 py-1 text-xs font-semibold text-[#64748b]">
          {reservations.length}
        </span>
      </div>
      <ul className="m-0 min-w-0 list-none space-y-3 p-0">
        {reservations.map((reservation) => (
          <CompactReservationItem
            key={reservation.id}
            locale={locale}
            reservation={reservation}
          />
        ))}
      </ul>
    </section>
  );
}

function ReservationPartyNote({
  locale,
  party,
}: {
  readonly locale: Locale;
  readonly party: CustomerReservationParty;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-start gap-1.5 break-words"
      data-account-reservation-party={party.kind}
    >
      <UserRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{getReservationPartyLabel(party, locale)}</span>
    </span>
  );
}

function ReservationDetailLink({
  locale,
  presentation = "button",
  reservation,
}: {
  readonly locale: Locale;
  readonly presentation?: "button" | "text";
  readonly reservation: CustomerReservationSummary;
}) {
  if (!reservation.workspaceReservationId) return null;

  const href = getReservationHref(locale, reservation.workspaceReservationId);

  if (presentation === "text") {
    return (
      <Button asChild variant="link" wrap>
        <GuardedLink href={href}>
          {m.accountReservationView({}, { locale })}
        </GuardedLink>
      </Button>
    );
  }

  return (
    <Button asChild size="sm" variant="secondary" wrap>
      <GuardedLink href={href}>
        {m.accountReservationView({}, { locale })}
      </GuardedLink>
    </Button>
  );
}

function GroupEmptyNotice({ empty }: { readonly empty: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#dfe4ec] bg-white px-4 py-6 text-sm leading-6 text-[#64748b]">
      {empty}
    </p>
  );
}

function ProviderUnavailableNotice({ locale }: { readonly locale: Locale }) {
  return (
    <section className="min-w-0">
      <div className="rounded-2xl border border-[#dfe4ec] bg-white p-6 shadow-[0_18px_40px_-28px_rgba(0,2,79,0.35)]">
        <h2 className="break-words text-xl font-semibold leading-tight text-[#00024f]">
          {m.accountReservationsUnavailableTitle({}, { locale })}
        </h2>
        <p className="mt-3 break-words text-sm leading-6 text-[#64748b]">
          {m.accountReservationsProviderUnavailable({}, { locale })}
        </p>
      </div>
    </section>
  );
}
