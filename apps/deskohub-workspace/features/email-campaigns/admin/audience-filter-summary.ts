import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import type { AudienceFilter } from "../audience-filter";

const localeNames: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech",
  "en-US": "English",
};

const reservationStatusNames = {
  in_progress: "in progress",
  complete: "complete",
  cancelled: "cancelled",
  needs_refund: "needing a refund",
} as const;

const describeDateRange = (from?: string, to?: string) => {
  if (from && to) return ` between ${from} and ${to}`;
  if (from) return ` from ${from}`;
  if (to) return ` until ${to}`;
  return "";
};

/** What a customer must satisfy, as a plural predicate ("speak Czech and …"). */
const describeCondition = (filter: AudienceFilter): string =>
  Match.value(filter).pipe(
    Match.tagsExhaustive({
      Reservation: ({ presence, dateBasis, from, to, status }) =>
        [
          presence === "has" ? "have a" : "have no",
          // Without a status only booked (confirmed, never cancelled)
          // reservations count.
          status ? ` ${reservationStatusNames[status]}` : " booked",
          " reservation",
          from || to
            ? ` ${dateBasis === "visit" ? "visiting" : "confirmed"}${describeDateRange(from, to)}`
            : "",
        ].join(""),
      Locale: ({ locales }) =>
        `speak ${locales.map((locale) => localeNames[locale]).join(" or ")}`,
      Account: ({ hasAccount }) =>
        hasAccount ? "have a Workspace account" : "have no Workspace account",
      DotyposTag: ({ tag }) => `are tagged “${tag}”`,
      DiscountGroup: ({ discountGroupId }) =>
        `are in discount group ${discountGroupId}`,
      Group: ({ operator, filters }) => {
        if (filters.length === 0) {
          return operator === "and" ? "match anything" : "match nothing";
        }
        const parts = filters.map((child) =>
          child._tag === "Group" && child.filters.length > 1
            ? `(${describeCondition(child)})`
            : describeCondition(child)
        );
        return parts.join(operator === "and" ? " and " : " or ");
      },
    })
  );

/** One sentence of plain English for an audience filter tree. */
export const describeAudienceFilter = (filter: AudienceFilter): string => {
  if (filter._tag === "Group" && filter.filters.length === 0) {
    return filter.operator === "and"
      ? "Every customer Workspace knows"
      : "Nobody";
  }
  return `Customers who ${describeCondition(filter)}`;
};

/**
 * The single locale every recipient of the audience has, when the filter
 * requires one: a one-locale condition at the root or directly inside the
 * root AND group. Campaign content then needs only that locale.
 */
export const audienceSingleLocale = (
  filter: AudienceFilter
): Locale | undefined => {
  if (filter._tag === "Group" && filter.operator === "or") return undefined;
  const conditions = filter._tag === "Group" ? filter.filters : [filter];
  for (const condition of conditions) {
    if (condition._tag === "Locale" && condition.locales.length === 1) {
      return condition.locales[0];
    }
  }
  return undefined;
};
