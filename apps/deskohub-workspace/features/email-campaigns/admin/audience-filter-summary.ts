import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import type { AudienceFilter } from "../audience-filter";

/** A Dotypos discount group an audience can filter by. */
export type DiscountGroupOption = {
  readonly id: string;
  readonly name: string;
};

const localeNames: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech",
  "en-US": "English",
};

/** How a status reads around "reservation": before it, or after it. */
const reservationStatusPhrases = {
  in_progress: { before: "", after: " in progress" },
  complete: { before: " complete", after: "" },
  cancelled: { before: " cancelled", after: "" },
  needs_refund: { before: "", after: " needing a refund" },
} as const;

const describeDateRange = (from?: string, to?: string) => {
  if (from && to) return ` between ${from} and ${to}`;
  if (from) return ` from ${from}`;
  if (to) return ` until ${to}`;
  return "";
};

/** What a customer must satisfy, as a plural predicate ("speak Czech and …"). */
const describeCondition = (
  filter: AudienceFilter,
  discountGroups: readonly DiscountGroupOption[]
): string =>
  Match.value(filter).pipe(
    Match.tagsExhaustive({
      Reservation: ({ presence, dateBasis, from, to, status }) =>
        [
          presence === "has" ? "have a" : "have no",
          // Without a status only booked (confirmed, never cancelled)
          // reservations count.
          status ? reservationStatusPhrases[status].before : " booked",
          " reservation",
          status ? reservationStatusPhrases[status].after : "",
          from || to
            ? ` ${dateBasis === "visit" ? "visiting" : "confirmed"}${describeDateRange(from, to)}`
            : "",
        ].join(""),
      Locale: ({ locales }) =>
        `speak ${locales.map((locale) => localeNames[locale]).join(" or ")}`,
      Account: ({ hasAccount }) =>
        hasAccount ? "have a Workspace account" : "have no Workspace account",
      DotyposTag: ({ tag }) => `are tagged “${tag}”`,
      DiscountGroup: ({ discountGroupId }) => {
        const group = discountGroups.find(({ id }) => id === discountGroupId);
        return group
          ? `are in discount group “${group.name}”`
          : `are in discount group ${discountGroupId}`;
      },
      Group: ({ operator, filters }) => {
        if (filters.length === 0) {
          return operator === "and" ? "match anything" : "match nothing";
        }
        const parts = filters.map((child) =>
          child._tag === "Group" && child.filters.length > 1
            ? `(${describeCondition(child, discountGroups)})`
            : describeCondition(child, discountGroups)
        );
        return parts.join(operator === "and" ? " and " : " or ");
      },
    })
  );

/**
 * One sentence of plain English for an audience filter tree. Discount groups
 * show by name when `discountGroups` lists them, otherwise by ID.
 */
export const describeAudienceFilter = (
  filter: AudienceFilter,
  discountGroups: readonly DiscountGroupOption[] = []
): string => {
  if (filter._tag === "Group" && filter.filters.length === 0) {
    return filter.operator === "and"
      ? "Every customer Workspace knows"
      : "Nobody";
  }
  return `Customers who ${describeCondition(filter, discountGroups)}`;
};
