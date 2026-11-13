import { m } from "@/features/i18n";

/** How long a plan lasts, in words: "for a year", "for 6 months". */
export function planDuration(durationDays: number): string {
  if (durationDays === 365) return m["membership.durationYear"]();
  if (durationDays === 182) return m["membership.durationHalfYear"]();
  if (durationDays === 30) return m["membership.durationMonth"]();
  return m["membership.durationDays"]({ days: durationDays });
}
