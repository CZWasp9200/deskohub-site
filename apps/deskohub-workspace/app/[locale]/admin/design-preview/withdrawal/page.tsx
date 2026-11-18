// DESIGN PREVIEW ONLY (online withdrawal visual rounds, screen 10): the real
// admin reservation detail and list over synthetic fixtures with customer
// withdrawals. Development builds only; removed before review.
import "@/shared/polyfills/temporal";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type {
  AdministrationReservationDetail as Detail,
  AdministrationReservationSummary as Summary,
} from "@/features/administration/administration.service";
import {
  loadFixtureReservation,
  loadFixtureReservations,
} from "@/features/administration/fixtures";
import { getAdministrationReservationListInput } from "@/features/administration/page-data.server";
import { AdministrationReservationDetail } from "@/features/administration/reservation-detail";
import { AdministrationReservationList } from "@/features/administration/reservation-list";

const czk = (value: number) =>
  ({ value: value * 100, exponent: 2, currency: "CZK" }) as const;
const at = (iso: string) => Temporal.Instant.from(iso).toString();

/** `settled`: a full refund, done. `failing`: partial, cancellation failing. */
const withdrawalOf = (state: string) =>
  state === "failing"
    ? {
        submittedAt: at("2026-11-18T12:01:00Z"),
        paidAmount: czk(4800),
        refundAmount: czk(1200),
        refundBasis: { kind: "partial", unit: "day", unstarted: 1, total: 4 },
        settlement: "needs_attention",
        failingSteps: [
          { step: "contract_cancellation", failureCode: "reservation_dotypos_unavailable" },
        ],
        steps: [
          { step: "receipt", doneAt: at("2026-11-18T12:01:04Z"), attempts: 0, failureCode: null, retryAt: null },
          { step: "operator_notice", doneAt: at("2026-11-18T12:01:05Z"), attempts: 0, failureCode: null, retryAt: null },
          { step: "contract_cancellation", doneAt: null, attempts: 6, failureCode: "reservation_dotypos_unavailable", retryAt: at("2026-11-18T14:31:00Z") },
        ],
      }
    : {
        submittedAt: at("2026-11-18T12:01:00Z"),
        paidAmount: czk(550),
        refundAmount: czk(550),
        refundBasis: { kind: "full" },
        settlement: "settled",
        failingSteps: [],
        steps: [
          { step: "receipt", doneAt: at("2026-11-18T12:01:04Z"), attempts: 0, failureCode: null, retryAt: null },
          { step: "operator_notice", doneAt: at("2026-11-18T12:01:05Z"), attempts: 0, failureCode: null, retryAt: null },
          { step: "contract_cancellation", doneAt: at("2026-11-18T12:01:09Z"), attempts: 0, failureCode: null, retryAt: null },
        ],
      };

// `current=1`: what today's admin shows for the same reservation, before
// the withdrawal UI (a confirmed booking whose payment owes a refund).
let current = false;

const withdrawnSummary = (base: Summary, state: string): Summary => {
  const withdrawal = withdrawalOf(state);
  if (current)
    return {
      ...base,
      status:
        state === "failing"
          ? { group: "in_progress", code: "in_progress", label: "In progress" }
          : { group: "cancelled", code: "cancelled", label: "Cancelled" },
      statusNote: "Needs refund",
      statusNoteCode: "needs_refund",
      latestPayment: base.latestPayment && {
        ...base.latestPayment,
        amount: withdrawal.paidAmount,
        refundState: "required",
        refundTarget: withdrawal.refundAmount,
      },
    } as never;
  return {
    ...base,
    status:
      state === "failing"
        ? { group: "attention", code: "withdrawn", label: "Withdrawn by customer" }
        : { group: "cancelled", code: "withdrawn", label: "Withdrawn by customer" },
    statusNote: "Needs refund",
    statusNoteCode: "needs_refund",
    latestPayment: base.latestPayment && {
      ...base.latestPayment,
      amount: withdrawal.paidAmount,
      refundState: "required",
      refundTarget: withdrawal.refundAmount,
    },
    withdrawal: {
      refundAmount: withdrawal.refundAmount,
      settlement: withdrawal.settlement,
    },
  } as never;
};

const loadDetail = (state: string) => async (): Promise<Detail> => {
  const base = loadFixtureReservation("0198-admin-fixture-complete");
  if (!base) notFound();
  const reservation = withdrawnSummary(base.reservation, state);
  return {
    ...base,
    canCancel: false,
    reservation,
    withdrawal: current ? null : (withdrawalOf(state) as never),
  };
};

const loadList = (status: string | undefined) => () => {
  const input = getAdministrationReservationListInput({});
  const base = loadFixtureReservations({ ...input, status: undefined });
  const items = base.items.map((item, index) =>
    index === 0
      ? withdrawnSummary(item, "failing")
      : index === 3
        ? withdrawnSummary(item, "settled")
        : item
  );
  // Needs attention: a withdrawal whose settlement fails, or any refund owed.
  const shown =
    status === "needs_attention"
      ? items.filter(
          (item) =>
            item.withdrawal?.settlement === "needs_attention" ||
            item.statusNoteCode === "needs_refund"
        )
      : items;
  return {
    input: Promise.resolve({ ...input, ...(status ? { status } : {}) } as never),
    result: Promise.resolve({ ...base, items: shown, total: shown.length }),
  };
};

export default async function AdminWithdrawalPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  await connection();
  const { view, state = "settled", status } = await searchParams;
  current = (await searchParams).current === "1";
  return view === "list" ? (
    <AdministrationReservationList
      load={loadList(status) as never}
      loadRefundAttention={(async () => 2) as never}
      searchParams={Promise.resolve({}) as never}
    />
  ) : (
    <AdministrationReservationDetail
      load={loadDetail(state)}
      params={Promise.resolve({ reservationId: "0198-admin-fixture-complete" })}
    />
  );
}
