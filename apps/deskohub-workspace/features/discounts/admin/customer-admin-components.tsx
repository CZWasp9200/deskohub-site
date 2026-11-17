import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  EmptyState,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import type { CustomerDiscountSlots } from "@/features/administration/customer-detail";
import { m } from "@/features/administration/i18n";
import { discountLabelFor } from "@/features/discounts/discount-label";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { formatMoney } from "@/shared/money/money";
import { formatCount } from "@/shared/utils/number";
import { VoucherEditor } from "./admin-tables";
import { toClaimHistoryItem } from "./claim-history-item";
import {
  AddCodeCustomerForm,
  AddVoucherCustomerForm,
  CustomerDiscountGroupForm,
} from "./customer-admin-client";
import {
  ClaimHistoryTable,
  CustomerPromotionCodeTable,
} from "./customer-admin-tables";
import { formatDiscountAdminCustomerName } from "./customer-display-name";
import {
  countCustomerAvailableCodes,
  customerClaimHistory,
  customerPromotionCodeValues,
  customerVisiblePromotionCodes,
  formatCustomerDiscountGroup,
} from "./customer-profile-display";
import type {
  AdminCustomerProfile,
  AdminDiscountCode,
  AdminDiscountCodeClaim,
  AdminDiscountCodeDetail,
  AdminVoucher,
  AdminVoucherClaim,
  AdminVoucherDetail,
} from "./discount-administration.service";
import { PromotionAudienceSection } from "./promotion-audience";
import { PromotionCustomerPicker } from "./promotion-customers";
import { formatDiscountCodeServiceDates } from "./service-date-display";
import { formatDiscountUsageLimit } from "./usage-limit";

type Notice = {
  readonly message: string;
  readonly status: "error" | "success";
};

export function CodeAdministrationDetailPage({
  detail,
  locale,
  notice,
}: {
  readonly detail: AdminDiscountCodeDetail;
  readonly locale: Locale;
  readonly notice?: Notice;
}) {
  const { code } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={code.code} />
      <AdministrationNoticeBanner notice={notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href={administrationHref("/[locale]/admin/codes")}>
            {m.discountsBackToCodes({}, { locale })}
          </Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={administrationHref("/[locale]/admin/codes")}>
            {m.discountsEditOrDeleteCode({}, { locale })}
          </Link>
        </Button>
      </div>

      <CodeSummary
        code={code}
        discountLabel={discountLabelFor(detail.discountLabels, locale)}
        locale={locale}
      />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PromotionAudienceSection
          customers={detail.customers}
          locale={locale}
          makeUnrestricted={{
            confirmation: m.discountsCodeMakeUnrestrictedConfirmation(
              {},
              { locale }
            ),
            mutation: { kind: "make-code-unrestricted", codeId: code.id },
          }}
          removeCustomer={(customerId, customerName) => ({
            confirmation: m.discountsCodeRemoveCustomerConfirmation(
              { customerName },
              { locale }
            ),
            mutation: {
              kind: "remove-code-customer",
              codeId: code.id,
              customerId,
            },
          })}
          summary={
            detail.customers.length === 0
              ? m.discountsCodeAudienceUnrestricted({}, { locale })
              : m.discountsCodeAudienceCount(
                  { count: detail.customers.length },
                  { locale }
                )
          }
        />

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5">
          <h2 className="font-semibold">
            {m.discountsAddCustomer({}, { locale })}
          </h2>
          <p className="mb-4 mt-1 text-sm leading-5 text-navy-blue/65">
            {m.discountsCodeAddCustomerDescription({}, { locale })}
          </p>
          <PromotionCustomerPicker
            audienceCustomerIds={code.audienceCustomerIds}
            code={code.code}
            deleteRedirect={administrationHref("/[locale]/admin/codes")}
            promotion={{ kind: "discount-code", id: code.id }}
          />
          <AddCustomerByIdDisclosure locale={locale}>
            <AddCodeCustomerForm codeId={code.id} />
          </AddCustomerByIdDisclosure>
        </aside>
      </div>

      <section className="mt-5">
        <h2 className="mb-3 font-semibold">
          {m.discountsClaimHistoryTitle({}, { locale })}
        </h2>
        <ClaimHistory
          ariaLabel={m.discountsCodeClaimHistoryLabel({}, { locale })}
          claims={detail.claims}
          emptyMessage={m.discountsCodeClaimsEmpty({}, { locale })}
          locale={locale}
          subject="customer"
        />
      </section>
    </AdministrationPage>
  );
}

export function VoucherAdministrationDetailPage({
  detail,
  locale,
  notice,
}: {
  readonly detail: AdminVoucherDetail;
  readonly locale: Locale;
  readonly notice?: Notice;
}) {
  const { voucher } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={voucher.code} />
      <AdministrationNoticeBanner notice={notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href={administrationHref("/[locale]/admin/vouchers")}>
            {m.discountsBackToVouchers({}, { locale })}
          </Link>
        </Button>
      </div>

      <VoucherSummary locale={locale} voucher={voucher} />

      <section className="mt-5 rounded-xl border border-navy-blue/10 bg-white p-5">
        <h2 className="mb-4 font-semibold">
          {m.discountsConfigurationTitle({}, { locale })}
        </h2>
        <VoucherEditor
          deletable
          deleteRedirect={administrationHref("/[locale]/admin/vouchers")}
          voucher={{
            ...voucher,
            validFrom: voucher.validFrom?.toString() ?? null,
            validUntil: voucher.validUntil?.toString() ?? null,
          }}
        />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PromotionAudienceSection
          customers={detail.customers}
          locale={locale}
          makeUnrestricted={{
            confirmation: m.discountsVoucherMakeUnrestrictedConfirmation(
              {},
              { locale }
            ),
            mutation: {
              kind: "make-voucher-unrestricted",
              voucherId: voucher.id,
            },
          }}
          removeCustomer={(customerId, customerName) => ({
            confirmation: m.discountsVoucherRemoveCustomerConfirmation(
              { customerName },
              { locale }
            ),
            mutation: {
              kind: "remove-voucher-customer",
              voucherId: voucher.id,
              customerId,
            },
          })}
          summary={
            detail.customers.length === 0
              ? m.discountsVoucherAudienceUnrestricted({}, { locale })
              : m.discountsVoucherAudienceCount(
                  { count: detail.customers.length },
                  { locale }
                )
          }
        />

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5">
          <h2 className="font-semibold">
            {m.discountsAddCustomer({}, { locale })}
          </h2>
          <p className="mb-4 mt-1 text-sm leading-5 text-navy-blue/65">
            {m.discountsVoucherAddCustomerDescription({}, { locale })}
          </p>
          <PromotionCustomerPicker
            audienceCustomerIds={voucher.audienceCustomerIds}
            code={voucher.code}
            deleteRedirect={administrationHref("/[locale]/admin/vouchers")}
            promotion={{ kind: "voucher", id: voucher.id }}
          />
          <AddCustomerByIdDisclosure locale={locale}>
            <AddVoucherCustomerForm voucherId={voucher.id} />
          </AddCustomerByIdDisclosure>
        </aside>
      </div>

      <section className="mt-5">
        <h2 className="mb-3 font-semibold">
          {m.discountsClaimHistoryTitle({}, { locale })}
        </h2>
        <ClaimHistory
          ariaLabel={m.discountsVoucherClaimHistoryLabel({}, { locale })}
          claims={detail.claims}
          emptyMessage={m.discountsVoucherClaimsEmpty({}, { locale })}
          locale={locale}
          subject="customer"
        />
      </section>
    </AdministrationPage>
  );
}

/**
 * Adding a customer by Dotypos ID, for a customer the name and email search
 * cannot single out.
 */
function AddCustomerByIdDisclosure({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  return (
    <details className="mt-5 border-t border-navy-blue/10 pt-4">
      <summary className="cursor-pointer text-sm font-semibold">
        {m.discountsAddCustomerById({}, { locale })}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/**
 * The discount sections of one customer's administration page, each for its
 * place in `AdministrationCustomerDetail`.
 */
export function renderCustomerDiscountSlots({
  locale,
  profile,
}: {
  readonly locale: Locale;
  readonly profile: AdminCustomerProfile;
}): CustomerDiscountSlots {
  const customerName = formatDiscountAdminCustomerName(
    profile.customer,
    locale
  );
  const visiblePromotionCodes = customerVisiblePromotionCodes(profile, locale);
  const availableCodes = countCustomerAvailableCodes(profile.codes);
  return {
    availableCodes: {
      label: m.discountsCustomerStatAvailableCodes({}, { locale }),
      value: `${formatCount(availableCodes.targeted, locale)} (+ ${formatCount(availableCodes.universal, locale)})`,
    },
    promotions: (
      <>
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl">
              {m.discountsCustomerCodesTitle({}, { locale })}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link
                  href={administrationHref(
                    "/[locale]/admin/customers/[customerId]/create-code",
                    { customerId: profile.customer.id }
                  )}
                >
                  <Plus aria-hidden className="size-4" />
                  {m.discountsCodeCreateSubmit({}, { locale })}
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link
                  href={administrationHref(
                    "/[locale]/admin/customers/[customerId]/create-voucher",
                    { customerId: profile.customer.id }
                  )}
                >
                  <Plus aria-hidden className="size-4" />
                  {m.discountsVoucherCreateSubmit({}, { locale })}
                </Link>
              </Button>
            </div>
          </div>
          {visiblePromotionCodes.length === 0 ? (
            <EmptyState
              message={m.discountsCustomerCodesEmpty({}, { locale })}
            />
          ) : (
            <CustomerPromotionCodeTable
              customerId={profile.customer.id}
              customerName={customerName}
              items={visiblePromotionCodes}
            />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xl">
            {m.discountsClaimHistoryTitle({}, { locale })}
          </h2>
          <ClaimHistory
            ariaLabel={m.discountsCustomerClaimHistoryLabel({}, { locale })}
            claims={customerClaimHistory(profile)}
            emptyMessage={m.discountsCustomerClaimsEmpty({}, { locale })}
            locale={locale}
            promotionCodes={customerPromotionCodeValues(profile)}
            subject="promotion-code"
          />
        </section>
      </>
    ),
    currentGroup: {
      label: m.discountsCustomerCurrentGroupLabel({}, { locale }),
      value: formatCustomerDiscountGroup(profile, locale),
    },
    groupForm: (
      <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
        <h2 className="mb-4 font-semibold">
          {m.discountsCustomerDiscountGroupTitle({}, { locale })}
        </h2>
        <CustomerDiscountGroupForm
          currentGroupId={profile.customer.discountGroupId}
          customerId={profile.customer.id}
          discountGroups={profile.discountGroups}
        />
      </section>
    ),
  };
}

const getSummaryStatus = (enabled: boolean, locale: Locale) =>
  enabled
    ? m.discountsStatusEnabled({}, { locale })
    : m.discountsStatusDisabled({}, { locale });

const getSummaryAudience = (audienceSize: number, locale: Locale) =>
  audienceSize === 0
    ? m.discountsAudienceUnrestricted({}, { locale })
    : m.discountsAudienceCustomerCount({ count: audienceSize }, { locale });

function CodeSummary({
  code,
  discountLabel,
  locale,
}: {
  readonly code: AdminDiscountCode;
  readonly discountLabel: string;
  readonly locale: Locale;
}) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryFact
        label={m.discountsColumnBenefit({}, { locale })}
        value={discountLabel}
      />
      <SummaryFact
        label={m.discountsColumnStatus({}, { locale })}
        value={getSummaryStatus(code.enabled, locale)}
      />
      <SummaryFact
        label={m.discountsValidFromLabel({}, { locale })}
        value={formatOptionalInstant(code.validFrom, locale)}
      />
      <SummaryFact
        label={m.discountsValidUntilLabel({}, { locale })}
        value={formatOptionalInstant(code.validUntil, locale)}
      />
      <SummaryFact
        label={m.discountsColumnServiceDates({}, { locale })}
        value={formatDiscountCodeServiceDates(code, locale)}
      />
      <SummaryFact
        label={m.discountsColumnAudience({}, { locale })}
        value={getSummaryAudience(code.audienceSize, locale)}
      />
      <SummaryFact
        label={m.discountsColumnReserved({}, { locale })}
        value={formatCount(code.reservedUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRedeemed({}, { locale })}
        value={formatCount(code.redeemedUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRemainingGlobally({}, { locale })}
        value={formatDiscountUsageLimit(code.remainingUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnUsesPerCustomer({}, { locale })}
        value={formatDiscountUsageLimit(code.maxUsesPerCustomer, locale)}
      />
    </dl>
  );
}

function VoucherSummary({
  locale,
  voucher,
}: {
  readonly locale: Locale;
  readonly voucher: AdminVoucher;
}) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryFact
        label={m.discountsColumnIssued({}, { locale })}
        value={formatMoney(voucher.issuedCredit, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRemaining({}, { locale })}
        value={formatMoney(voucher.remainingCredit, locale)}
      />
      <SummaryFact
        label={m.discountsColumnStatus({}, { locale })}
        value={getSummaryStatus(voucher.enabled, locale)}
      />
      <SummaryFact
        label={m.discountsColumnAudience({}, { locale })}
        value={getSummaryAudience(voucher.audienceSize, locale)}
      />
      <SummaryFact
        label={m.discountsValidFromLabel({}, { locale })}
        value={formatOptionalInstant(voucher.validFrom, locale)}
      />
      <SummaryFact
        label={m.discountsValidUntilLabel({}, { locale })}
        value={formatOptionalInstant(voucher.validUntil, locale)}
      />
      <SummaryFact
        label={m.discountsColumnReserved({}, { locale })}
        value={formatCount(voucher.reservedUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRedeemed({}, { locale })}
        value={formatCount(voucher.redeemedUses, locale)}
      />
    </dl>
  );
}

function SummaryFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-blue/65">
        {label}
      </dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function ClaimHistory({
  ariaLabel,
  claims,
  emptyMessage,
  locale,
  promotionCodes,
  subject,
}: {
  readonly ariaLabel: string;
  readonly claims: readonly (AdminDiscountCodeClaim | AdminVoucherClaim)[];
  readonly emptyMessage: string;
  readonly locale: Locale;
  /** Code values keyed by `discount-code:<id>` or `voucher:<id>`. */
  readonly promotionCodes?: ReadonlyMap<string, string>;
  readonly subject: "customer" | "promotion-code";
}) {
  if (claims.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <ClaimHistoryTable
      ariaLabel={ariaLabel}
      claims={claims.map((claim) =>
        toClaimHistoryItem(claim, locale, promotionCodes)
      )}
      subject={subject}
    />
  );
}

const formatOptionalInstant = (
  instant: Temporal.Instant | null,
  locale: Locale
) => (instant ? formatAdministrationDateTime(instant.toString(), locale) : "—");
