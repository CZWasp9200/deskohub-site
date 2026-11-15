const dayMs = 24 * 60 * 60 * 1000;

/** Whole days until the membership ends, counting a started day as a day. */
export const membershipDaysLeft = (endsAt: Date, now: Date): number =>
  Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / dayMs));

/** The plural form a count takes in the language, for picking the wording. */
export const daysLeftForm = (
  count: number,
  locale: string
): "one" | "few" | "other" => {
  const category = new Intl.PluralRules(locale).select(count);
  return category === "one" || category === "few" ? category : "other";
};
