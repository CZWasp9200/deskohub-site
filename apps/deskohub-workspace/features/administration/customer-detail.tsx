import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { formatMoney, type Money } from "@/shared/money/money";
import { formatCount } from "@/shared/utils/number";
import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationCustomerActivity,
  AdministrationCustomerMarketingConsent,
  AdministrationCustomerReservationActivity,
  AdministrationCustomerTransaction,
} from "./administration.service";
import { administrationHref } from "./administration-href";
import {
  AdministrationFact,
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  CustomerReservationActivity,
  EmptyState,
  formatAdministrationDateTime,
  ReservationTable,
} from "./components";
import { groupCustomerReservations } from "./customer-activity";
import type { AdministrationCustomer } from "./customer-identity";
import { getAdministrationCustomerName } from "./customer-presentation";
import { CustomerTransactionHistoryTable } from "./customer-transaction-table";
import { m } from "./i18n";
import type { AdministrationNotice } from "./notice";
import { getAdministrationReservationProductTitle } from "./reservation-product";

/** A labelled value the discount administration places in the detail's own layout. */
type CustomerDetailFact = {
  readonly label: string;
  readonly value: string;
};

/**
 * What the discount administration contributes to the customer detail, each
 * in its place in the administration's layout.
 */
export type CustomerDiscountSlots = {
  /** The last stat: the codes and vouchers the customer can use. */
  readonly availableCodes: CustomerDetailFact;
  /** The sections after the transactions: codes and vouchers, then claims. */
  readonly promotions: ReactNode;
  /** The contact card's last fact: the customer's discount group. */
  readonly currentGroup: CustomerDetailFact;
  /** The section between the contact card and the reference. */
  readonly groupForm: ReactNode;
};

/**
 * One Dotypos customer's administration page: their activity, reservations,
 * transactions and contact details, with the discount sections in place.
 */
export function AdministrationCustomerDetail({
  activity,
  customerId,
  locale,
  notice,
  profile,
  reservationActivity,
}: {
  readonly activity: AdministrationCustomerActivity;
  /** The decoded route id, for the unavailable layout's links. */
  readonly customerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly notice?: AdministrationNotice;
  /**
   * The Dotypos customer and the discount sections. Without both the page
   * shows only the customer's Workspace reservation history.
   */
  readonly profile: {
    readonly customer: AdministrationCustomer;
    readonly discounts: CustomerDiscountSlots;
  } | null;
  readonly reservationActivity: AdministrationCustomerReservationActivity;
}) {
  if (!profile) {
    return (
      <UnavailableCustomerDetail
        activity={activity}
        customerId={customerId}
        locale={locale}
        notice={notice}
      />
    );
  }
  const { customer, discounts } = profile;
  const customerName = getAdministrationCustomerName(customer, locale);
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={customerName} />
      <AdministrationNoticeBanner notice={notice} />

      <CustomerReservationActivity
        activity={reservationActivity}
        locale={locale}
      />

      <div className="mb-7 grid gap-5 lg:grid-cols-2">
        <CustomerStats
          activity={activity}
          availableCodes={discounts.availableCodes}
          locale={locale}
        />
        <CustomerConsents consent={activity.marketingConsent} locale={locale} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-7">
          <CustomerReservations
            activity={activity}
            customerId={customer.id}
            locale={locale}
          />

          <section>
            <h2 className="mb-3 text-xl">
              {m.administrationCustomerProfileTransactionsTitle({}, { locale })}
            </h2>
            {activity.transactionHistoryTruncated && (
              <p className="mb-3 text-sm text-navy-blue/65">
                {m.administrationCustomerProfileTransactionsTruncated(
                  {},
                  { locale }
                )}
              </p>
            )}
            <CustomerTransactionHistory
              locale={locale}
              transactions={activity.transactions}
            />
          </section>

          {discounts.promotions}
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
            <h2 className="font-semibold">
              {m.administrationCustomerProfileContactTitle({}, { locale })}
            </h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <AdministrationFact
                label={m.administrationCustomerProfileEmailLabel(
                  {},
                  { locale }
                )}
                value={customer.email ?? "—"}
              />
              <AdministrationFact
                label={m.administrationCustomerProfilePhoneLabel(
                  {},
                  { locale }
                )}
                value={customer.phone ?? "—"}
              />
              <AdministrationFact
                label={discounts.currentGroup.label}
                value={discounts.currentGroup.value}
              />
            </dl>
          </section>

          {discounts.groupForm}

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              {m.administrationCustomerProfileReferenceTitle({}, { locale })}
            </summary>
            <div className="border-t border-navy-blue/10 px-5 py-4">
              <AdministrationFact
                label={m.administrationCustomerProfileIdLabel({}, { locale })}
                value={customer.id}
                valueClassName="break-all font-mono text-xs"
              />
            </div>
          </details>
        </aside>
      </div>
    </AdministrationPage>
  );
}

/**
 * The customer detail when Dotypos can't show the customer or the discount
 * sections can't load: the Workspace reservation history alone.
 */
function UnavailableCustomerDetail({
  activity,
  customerId,
  locale,
  notice,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly customerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly notice?: AdministrationNotice;
}) {
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        description={m.administrationCustomerDetailUnavailableDescription(
          {},
          { locale }
        )}
        eyebrow={m.administrationCustomerDetailEyebrow({}, { locale })}
        title={m.administrationCustomerDetailUnavailableTitle({}, { locale })}
      />
      <AdministrationNoticeBanner notice={notice} />
      {activity.reservationHistoryTruncated && (
        <p className="mb-3 text-sm text-navy-blue/65">
          {m.administrationCustomerDetailReservationsTruncated({}, { locale })}{" "}
          <Link
            className="font-semibold underline underline-offset-4"
            href={`${administrationHref(
              "/[locale]/admin/reservations"
            )}?customerId=${encodeURIComponent(customerId)}`}
          >
            {m.administrationCustomerDetailViewAllReservations({}, { locale })}
          </Link>
        </p>
      )}
      <ReservationTable
        emptyMessage={m.administrationCustomerDetailNoReservations(
          {},
          { locale }
        )}
        reservations={activity.reservations}
      />
    </AdministrationPage>
  );
}

function CustomerReservations({
  activity,
  customerId,
  locale,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly customerId: DotyposCustomerId;
  readonly locale: Locale;
}) {
  const reservationGroups = groupCustomerReservations(activity.reservations);
  return (
    <section>
      <h2 className="mb-3 text-xl">
        {m.administrationCustomerProfileReservationsTitle({}, { locale })}
      </h2>
      {activity.reservationHistoryTruncated && (
        <p className="mb-3 text-sm text-navy-blue/65">
          {m.administrationCustomerProfileReservationsTruncated({}, { locale })}{" "}
          <Link
            className="font-semibold underline underline-offset-4"
            href={`${administrationHref(
              "/[locale]/admin/reservations"
            )}?customerId=${encodeURIComponent(customerId)}`}
          >
            {m.administrationCustomerProfileViewAllReservations({}, { locale })}
          </Link>
        </p>
      )}
      <div className="space-y-4">
        <details className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
          <summary className="cursor-pointer px-5 py-4 font-semibold">
            {m.administrationCustomerProfilePastReservations(
              {
                count: formatCount(reservationGroups.past.length, locale),
              },
              { locale }
            )}
          </summary>
          <div className="border-t border-navy-blue/10 p-3">
            <ReservationTable
              emptyMessage={m.administrationCustomerProfilePastReservationsEmpty(
                {},
                { locale }
              )}
              reservations={reservationGroups.past}
              showCustomer={false}
            />
          </div>
        </details>

        <section aria-labelledby="current-reservations-heading">
          <h3 className="mb-3 font-semibold" id="current-reservations-heading">
            {m.administrationCustomerProfileCurrentReservations({}, { locale })}
          </h3>
          <ReservationTable
            emptyMessage={
              activity.reservationHistoryTruncated
                ? m.administrationCustomerProfileCurrentReservationsTruncatedEmpty(
                    {},
                    { locale }
                  )
                : m.administrationCustomerProfileCurrentReservationsEmpty(
                    {},
                    { locale }
                  )
            }
            reservations={reservationGroups.currentAndFuture}
            showCustomer={false}
          />
        </section>

        {reservationGroups.unavailable.length > 0 && (
          <details className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 font-semibold">
              {m.administrationCustomerProfileUnavailableDateReservations(
                {
                  count: formatCount(
                    reservationGroups.unavailable.length,
                    locale
                  ),
                },
                { locale }
              )}
            </summary>
            <div className="border-t border-navy-blue/10 p-3">
              <ReservationTable
                reservations={reservationGroups.unavailable}
                showCustomer={false}
              />
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function CustomerStats({
  activity,
  availableCodes,
  locale,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly availableCodes: CustomerDetailFact;
  readonly locale: Locale;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl">
        {m.administrationCustomerProfileStatsTitle({}, { locale })}
      </h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerStat
          label={m.administrationCustomerProfileStatReservations(
            {},
            { locale }
          )}
          value={formatCount(activity.stats.reservationCount, locale)}
        />
        <CustomerStat
          label={m.administrationCustomerProfileStatRevenue({}, { locale })}
          value={formatMoneyTotals(activity.stats.revenue, locale)}
        />
        <CustomerStat
          label={m.administrationCustomerProfileStatFavoriteProduct(
            {},
            { locale }
          )}
          value={
            activity.stats.favoriteReservationProduct
              ? getAdministrationReservationProductTitle(
                  activity.stats.favoriteReservationProduct,
                  locale
                )
              : "—"
          }
        />
        <CustomerStat
          label={m.administrationCustomerProfileStatDiscountSavings(
            {},
            { locale }
          )}
          value={formatMoneyTotals(activity.stats.discountSavings, locale)}
        />
        <CustomerStat
          label={availableCodes.label}
          value={availableCodes.value}
        />
      </dl>
    </section>
  );
}

function CustomerStat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-navy-blue/8 px-4 py-2.5 last:border-b-0 odd:bg-navy-blue/[0.025]">
      <dt className="text-sm text-navy-blue/72">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function CustomerConsents({
  consent,
  locale,
}: {
  readonly consent: AdministrationCustomerMarketingConsent | null;
  readonly locale: Locale;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl">
        {m.administrationCustomerProfileConsentsTitle({}, { locale })}
      </h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerConsent consent={consent} locale={locale} />
      </dl>
    </section>
  );
}

function CustomerConsent({
  consent,
  locale,
}: {
  readonly consent: AdministrationCustomerMarketingConsent | null;
  readonly locale: Locale;
}) {
  const withdrawnAt = consent?.withdrawnAt;
  return (
    <div className="grid gap-1 border-b border-navy-blue/8 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <dt className="font-medium">
        {m.administrationCustomerProfileConsentMarketing({}, { locale })}
      </dt>
      <dd className="text-sm text-navy-blue/65 sm:text-right">
        {consent ? (
          <>
            <StatusBadge tone={withdrawnAt ? "attention" : "positive"}>
              {withdrawnAt
                ? m.administrationCustomerProfileConsentWithdrawn(
                    {},
                    { locale }
                  )
                : m.administrationCustomerProfileConsentGranted({}, { locale })}
            </StatusBadge>{" "}
            ·{" "}
            {formatAdministrationDateTime(
              withdrawnAt ?? consent.grantedAt,
              locale
            )}
            <span className="mt-0.5 block break-all text-xs">
              {withdrawnAt && (
                <>
                  {m.administrationCustomerProfileConsentGrantedAt(
                    {
                      date: formatAdministrationDateTime(
                        consent.grantedAt,
                        locale
                      ),
                    },
                    { locale }
                  )}{" "}
                  ·{" "}
                </>
              )}
              {consent.locale} · {consent.documentHash}
            </span>
          </>
        ) : (
          m.administrationCustomerProfileConsentNotGranted({}, { locale })
        )}
      </dd>
    </div>
  );
}

function CustomerTransactionHistory({
  locale,
  transactions,
}: {
  readonly locale: Locale;
  readonly transactions: readonly AdministrationCustomerTransaction[];
}) {
  if (transactions.length === 0) {
    return (
      <EmptyState
        message={m.administrationCustomerProfileTransactionsEmpty(
          {},
          { locale }
        )}
      />
    );
  }
  return (
    <CustomerTransactionHistoryTable
      transactions={transactions.map((transaction) => ({
        ...transaction,
        updatedAtLabel: formatAdministrationDateTime(
          transaction.attempt.updatedAt,
          locale
        ),
      }))}
    />
  );
}

const formatMoneyTotals = (totals: readonly Money[], locale: Locale) =>
  totals.length > 0
    ? totals.map((total) => formatMoney(total, locale)).join(" + ")
    : "—";
