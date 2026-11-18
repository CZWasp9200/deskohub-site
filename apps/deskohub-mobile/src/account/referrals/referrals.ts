import type { ReferralAccountOverview } from "@deskohub/workspace-customer-api";
import { Effect, Match } from "effect";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import { Clipboard, ShareSheet } from "../../customer-api/device-capabilities";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";

/**
 * The account's referral summary and share link (GET /account/referrals).
 * The API answers 404 feature-unavailable while referrals aren't released.
 */
export const referralsAtom = customerDataRuntime.atom(
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.getReferrals()
  ).pipe(customerRead({ accountRead: false }))
);

/** Copies the referral code. It is meant to be passed on, so not sensitive. */
export const copyReferralCodeAtom = customerDataRuntime.fn((code: string) =>
  Effect.flatMap(Effect.service(Clipboard), (clipboard) =>
    clipboard.copy(code, { sensitive: false })
  )
);

/** Opens the share sheet with the referral link and an invitation. */
export const shareReferralLinkAtom = customerDataRuntime.fn(
  (link: { readonly url: string; readonly message: string }) =>
    Effect.flatMap(Effect.service(ShareSheet), (share) => share.shareLink(link))
);

/**
 * A referral percentage exactly, such as "9.75%" for two invitees'
 * compounded 5%, as the account's own rows show it.
 */
export const formatExactReferralDiscount = (
  discount: string,
  locale: AppLocale
): string =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(Number(discount) / 100);

/**
 * The compounding behind the referrer discount, as the (i) on "Your
 * discount" explains it: `perInvitee` for each of `referrals` friends adds
 * up to `total`, not `referrals` × `perInvitee`. Before anyone counts, it
 * shows one friend's worth.
 */
export interface ReferralDiscountExample {
  readonly perInvitee: string;
  readonly referrals: number;
  readonly total: string;
}

/**
 * Who joined, as one sentence: "3 people joined with your code; 2 count
 * toward your discount", each count in its plural form.
 */
export const joinedSentence = (
  joined: ReferralsView["joined"],
  locale: AppLocale
): string =>
  joined.kind === "nobody"
    ? m.referrals_joined_nobody({}, { locale })
    : m.referrals_joined_some(
        {
          invitees: m.referrals_joined_invitees(
            { count: joined.invitees },
            { locale }
          ),
          eligible:
            joined.eligibleInvitees === 0
              ? m.referrals_joined_eligible_none({}, { locale })
              : m.referrals_joined_eligible(
                  { count: joined.eligibleInvitees },
                  { locale }
                ),
        },
        { locale }
      );

/** What the Invite friends screen shows for an overview. */
export interface ReferralsView {
  readonly code: string;
  readonly shareUrl: string;
  /** Who joined: nobody yet, or everyone and how many count now. */
  readonly joined:
    | { readonly kind: "nobody" }
    | {
        readonly kind: "some";
        readonly invitees: number;
        readonly eligibleInvitees: number;
      };
  /** The referrer discount exactly, such as "9.75%". */
  readonly discount: string;
  /**
   * One formatted total per currency; with nothing saved, a zero in the
   * server's currency, or nothing from a Workspace that doesn't say it.
   */
  readonly savings: ReadonlyArray<string>;
  /** The invited friend's first-booking discount, when the server says. */
  readonly invitationDiscount: string | undefined;
  /** The discount each friend who keeps visiting adds, when the server says. */
  readonly discountPerInvitee: string | undefined;
  readonly example: ReferralDiscountExample | undefined;
}

const discountExample = (
  perInvitee: string,
  counted: number,
  discount: string,
  locale: AppLocale
): ReferralDiscountExample =>
  counted === 0
    ? { perInvitee, referrals: 1, total: perInvitee }
    : {
        perInvitee,
        referrals: counted,
        total: formatExactReferralDiscount(discount, locale),
      };

/**
 * The screen's numbers, every rate from the server's overview: an older
 * Workspace may leave out a programme rate, and then the screen words that
 * step without it.
 */
export const referralsView = (
  {
    summary,
    shareUrl,
    discountPerInvitee,
    invitationDiscount,
    savingsCurrency,
  }: ReferralAccountOverview,
  locale: AppLocale
): ReferralsView => {
  const counted = summary.eligibleInviteeCount;
  const perInvitee =
    discountPerInvitee === undefined
      ? undefined
      : formatExactReferralDiscount(discountPerInvitee, locale);
  return {
    code: summary.code,
    shareUrl,
    joined:
      summary.inviteeCount === 0
        ? { kind: "nobody" }
        : {
            kind: "some",
            invitees: summary.inviteeCount,
            eligibleInvitees: counted,
          },
    discount: formatExactReferralDiscount(summary.discount, locale),
    savings:
      summary.savings.length === 0 && savingsCurrency !== undefined
        ? [
            formatMoney(
              { value: 0, exponent: 0, currency: savingsCurrency },
              locale
            ),
          ]
        : summary.savings.map((money) => formatMoney(money, locale)),
    invitationDiscount:
      invitationDiscount === undefined
        ? undefined
        : formatExactReferralDiscount(invitationDiscount, locale),
    discountPerInvitee: perInvitee,
    example:
      perInvitee === undefined
        ? undefined
        : discountExample(perInvitee, counted, summary.discount, locale),
  };
};

/** How long the copy button shows its check after a copy. */
export const copiedFeedbackMs = 2000;

/**
 * How the Referrals screen words a failed read: referrals not released, or
 * the summary unavailable for now. Session, rate-limit and link failures keep
 * the shared wording.
 */
export type ReferralsFailure = "not-released" | "summary-unavailable";

export const referralsFailure = (
  error: CustomerViewError
): ReferralsFailure | undefined =>
  Match.value(error).pipe(
    Match.tag("FeatureUnavailable", () => "not-released" as const),
    Match.tag(
      "Unavailable",
      "TimedOut",
      "Unexpected",
      () => "summary-unavailable" as const
    ),
    Match.orElse(() => undefined)
  );
