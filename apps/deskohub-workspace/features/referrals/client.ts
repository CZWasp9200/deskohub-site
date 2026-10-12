import { Schema } from "effect";
import {
  formatDiscountAdjustment,
  formatDiscountReduction,
} from "@/features/checkout/format-discount-adjustment";
import type { Locale } from "@/features/i18n";
import { referralInvitationDiscountBasisPoints } from "./program";

const referralCodeCodec = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9][A-Z0-9_-]{2,63}$/)
)
  .pipe(Schema.brand("ReferralCode"))
  .annotate({
    identifier: "ReferralCode",
    description:
      "Uppercase ASCII referral code in the shared promotion namespace.",
  });

export type ReferralCode = typeof referralCodeCodec.Type;

// biome-ignore lint/plugin: This parser is the browser-safe boundary for untrusted code values; the referral schema validates them here.
export const parseReferralCode = (value: unknown): ReferralCode | undefined =>
  Schema.is(referralCodeCodec)(value) ? value : undefined;

/** Search parameter that carries a shared referral code between pages. */
export const referralCodeQueryParam = "ref";

/**
 * Absolute share link for a referral code. It carries no locale, so the
 * proxy's language detection opens it in the recipient's language.
 */
export const getReferralShareUrl = (code: ReferralCode, origin: URL) =>
  new URL(
    `/account?${new URLSearchParams({ [referralCodeQueryParam]: code })}`,
    origin
  ).href;

/**
 * Formats the referrer discount, a canonical decimal percentage such as
 * "14.2625", rounded up to a whole percent for display. Pricing keeps the
 * exact value.
 */
export const formatReferralDiscount = (discount: string, locale: Locale) =>
  formatDiscountAdjustment(roundUpReferralDiscount(discount), locale);

/** The referrer discount as a price reduction, such as "-15%". */
export const formatReferralDiscountReduction = (
  discount: string,
  locale: Locale
) => formatDiscountReduction(roundUpReferralDiscount(discount), locale);

const roundUpReferralDiscount = (discount: string) => {
  const [whole = "0", fraction = ""] = discount.split(".");
  const percent = Number(whole) + (/[1-9]/.test(fraction) ? 1 : 0);
  return { kind: "percentage", basisPoints: percent * 100 } as const;
};

/** The invited customer's first-booking discount, such as "15%". */
export const formatReferralInvitationDiscount = (locale: Locale) =>
  formatDiscountAdjustment(
    { kind: "percentage", basisPoints: referralInvitationDiscountBasisPoints },
    locale
  );
