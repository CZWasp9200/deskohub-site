import type {
  AdministrationReservationWithdrawalType,
  AdministrationWorkspaceReservationIdType,
} from "@deskohub/workspace-admin-api";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { Locale } from "@/features/i18n";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";
import { formatMoney } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import type { AdministrationCustomer } from "./customer-identity";
import { formatAdministrationDateTime } from "./formatters";
import { m } from "./i18n";
import { ReservationWithdrawalRetry } from "./reservation-withdrawal-retry";

type AdministrationWithdrawalStep =
  AdministrationReservationWithdrawalType["steps"][number];

const settlementTone = {
  settled: "positive",
  in_progress: "progress",
  needs_attention: "attention",
} as const satisfies Record<
  AdministrationReservationWithdrawalType["settlement"],
  StatusTone
>;

const settlementLabel = (
  settlement: AdministrationReservationWithdrawalType["settlement"],
  locale: Locale
) =>
  ({
    settled: m.administrationWithdrawalSettled,
    in_progress: m.administrationWithdrawalInProgress,
    needs_attention: m.administrationWithdrawalNeedsAttention,
  })[settlement]({}, { locale });

const stepLabel = (
  step: AdministrationWithdrawalStep["step"],
  locale: Locale
) =>
  ({
    receipt: m.administrationWithdrawalStepReceipt,
    operator_notice: m.administrationWithdrawalStepOperatorNotice,
    contract_cancellation: m.administrationWithdrawalStepCancellation,
  })[step]({}, { locale });

const pragueTime = (value: string, locale: Locale) =>
  m.administrationWithdrawalPragueTime(
    { time: formatAdministrationDateTime(value, locale) },
    { locale }
  );

/**
 * A customer's online withdrawal from the reservation: when, who, what is
 * owed, and how its settlement runs (receipt, staff notice, cancellation).
 * Failing steps lead, with a way to run the settlement again.
 */
export function ReservationWithdrawalSection({
  customer,
  locale,
  reservationId,
  withdrawal,
}: {
  readonly customer: AdministrationCustomer | null;
  readonly locale: Locale;
  readonly reservationId: AdministrationWorkspaceReservationIdType;
  readonly withdrawal: AdministrationReservationWithdrawalType;
}) {
  const failing = withdrawal.steps.filter((step) => step.status === "failed");
  const kept = {
    ...withdrawal.paidAmount,
    value: withdrawal.paidAmount.value - withdrawal.refundAmount.value,
  };
  const basis = withdrawal.refundBasis;

  return (
    <section
      aria-labelledby="withdrawal-heading"
      className={cn(
        "rounded-xl border bg-white p-5 sm:p-6",
        failing.length > 0 ? "border-red-200" : "border-navy-blue/10"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl" id="withdrawal-heading">
          {m.administrationWithdrawalHeading({}, { locale })}
        </h2>
        <StatusBadge tone={settlementTone[withdrawal.settlement]}>
          {settlementLabel(withdrawal.settlement, locale)}
        </StatusBadge>
      </div>

      <ReservationWithdrawalRetry locale={locale} reservationId={reservationId}>
        {failing.length > 0 && (
          <>
            <p className="font-semibold">
              {m.administrationWithdrawalFailingTitle(
                {
                  steps: failing
                    .map((step) => stepLabel(step.step, locale))
                    .join(", "),
                },
                { locale }
              )}
            </p>
            <p className="mt-1">
              {m.administrationWithdrawalFailingBody({}, { locale })}
            </p>
          </>
        )}
      </ReservationWithdrawalRetry>

      <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/55">
            {m.administrationWithdrawalSubmitted({}, { locale })}
          </dt>
          <dd className="mt-1 font-semibold">
            {pragueTime(withdrawal.submittedAt, locale)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/55">
            {m.administrationWithdrawalCustomer({}, { locale })}
          </dt>
          <dd className="mt-1 min-w-0">
            <span className="block font-semibold">
              {customer?.hasName
                ? customer.displayName
                : m.administrationWithdrawalNoName({}, { locale })}
            </span>
            {customer?.email && (
              <span className="block break-all text-sm text-navy-blue/65">
                {customer.email}
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/55">
            {m.administrationWithdrawalRefund({}, { locale })}
          </dt>
          <dd className="mt-1">
            {basis.kind === "partial" ? (
              <dl className="grid gap-1 text-sm tabular-nums">
                <div className="flex justify-between gap-4">
                  <dt>{m.administrationWithdrawalPaid({}, { locale })}</dt>
                  <dd>{formatMoney(withdrawal.paidAmount, locale)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-navy-blue/60">
                  <dt>
                    {(basis.unit === "hour"
                      ? m.administrationWithdrawalStartedHours
                      : m.administrationWithdrawalStartedDays)(
                      {
                        started: basis.total - basis.unstarted,
                        total: basis.total,
                      },
                      { locale }
                    )}
                  </dt>
                  <dd>−{formatMoney(kept, locale)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-navy-blue/10 pt-1 font-semibold">
                  <dt>{m.administrationWithdrawalRefund({}, { locale })}</dt>
                  <dd>{formatMoney(withdrawal.refundAmount, locale)}</dd>
                </div>
              </dl>
            ) : (
              <span className="font-semibold tabular-nums">
                {formatMoney(withdrawal.refundAmount, locale)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/55">
        {m.administrationWithdrawalSteps({}, { locale })}
      </h3>
      <ol className="mt-2 divide-y divide-navy-blue/10 rounded-lg border border-navy-blue/10">
        {withdrawal.steps.map((step) => (
          <WithdrawalStepRow key={step.step} locale={locale} step={step} />
        ))}
      </ol>
    </section>
  );
}

const stepProgressIcon = {
  done: { Icon: CheckCircle2, iconClassName: "text-aquamarine-ink" },
  failed: { Icon: AlertCircle, iconClassName: "text-red-700" },
  pending: { Icon: Clock, iconClassName: "text-navy-blue/45" },
} as const satisfies Record<
  AdministrationWithdrawalStep["status"],
  { readonly Icon: typeof Clock; readonly iconClassName: string }
>;

const stepProgressText = (
  step: AdministrationWithdrawalStep,
  locale: Locale
) => {
  if (step.doneAt) {
    return m.administrationWithdrawalStepDone(
      { time: pragueTime(step.doneAt, locale) },
      { locale }
    );
  }
  return step.status === "pending"
    ? m.administrationWithdrawalStepPending({}, { locale })
    : m.administrationWithdrawalStepFailed(
        { attempts: step.attempts },
        { locale }
      );
};

function WithdrawalStepRow({
  locale,
  step,
}: {
  readonly locale: Locale;
  readonly step: AdministrationWithdrawalStep;
}) {
  const progress = step.status;
  const failed = progress === "failed";
  const { Icon, iconClassName } = stepProgressIcon[progress];
  return (
    <li className="flex min-w-0 items-start gap-3 px-4 py-3 text-sm">
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", iconClassName)}
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{stepLabel(step.step, locale)}</p>
        <p
          className={cn(
            "mt-0.5",
            failed ? "text-red-800" : "text-navy-blue/65"
          )}
        >
          {stepProgressText(step, locale)}
        </p>
        {failed && (
          <p className="mt-1 text-navy-blue/65">
            <span className="font-mono text-xs">{step.failureCode}</span>
            {step.retryAt && (
              <>
                {" · "}
                {m.administrationWithdrawalNextRetry(
                  { time: pragueTime(step.retryAt, locale) },
                  { locale }
                )}
              </>
            )}
          </p>
        )}
      </div>
    </li>
  );
}
