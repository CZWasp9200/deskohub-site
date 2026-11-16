import { dayOf } from "@/features/events/calendar-month";

/** One paid membership period of a customer. */
export type MembershipPeriod = {
  readonly planName: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
};

/** The membership a customer has right now, as the website shows it. */
export type CurrentMembership = {
  /** The plan of the period running now, not of a renewal after it. */
  readonly planName: string;
  /** When the membership ends, counting periods that follow without a gap. */
  readonly endsAt: Date;
};

/**
 * The membership running at `now`, or `null` when no period is running.
 *
 * - A period that starts later doesn't make the customer a member yet.
 * - Periods that start by the time the previous one ends extend it, so a
 *   renewal shows up as a later end date.
 * - A period after a gap is not counted: the end date stops at the gap.
 */
export function currentMembership(
  periods: readonly MembershipPeriod[],
  now: Date
): CurrentMembership | null {
  const running = periods
    .filter((period) => period.startsAt <= now && period.endsAt > now)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  if (!running) return null;

  let endsAt = running.endsAt;
  const byStart = [...periods].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );
  for (const period of byStart) {
    if (period.startsAt <= endsAt && period.endsAt > endsAt) {
      endsAt = period.endsAt;
    }
  }
  return { planName: running.planName, endsAt };
}

/**
 * The last moment that still belongs to a membership ending at `endsAt`. A
 * membership ending at midnight ends with the previous day, so dates shown
 * to the customer use this instead of `endsAt`.
 */
export const membershipLastMoment = (endsAt: Date): Date =>
  new Date(endsAt.getTime() - 1);

/**
 * Calendar days in the bar's time zone the membership still covers, today
 * included: on the last day it is 1.
 */
export function membershipDaysLeft(endsAt: Date, now: Date): number {
  const lastDay = dayOf(membershipLastMoment(endsAt));
  const today = dayOf(now);
  return Math.max(1, today.until(lastDay, { largestUnit: "days" }).days + 1);
}

/** The plural form a count takes in the language, for picking the wording. */
export const daysLeftForm = (
  count: number,
  locale: string
): "one" | "few" | "other" => {
  const category = new Intl.PluralRules(locale).select(count);
  return category === "one" || category === "few" ? category : "other";
};
