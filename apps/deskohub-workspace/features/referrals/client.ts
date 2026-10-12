import { Schema } from "effect";

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
