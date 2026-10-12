"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ProfileCompletionReferralOutcome } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";

type ProfileCompletionReferralNoticeState = {
  readonly outcome: ProfileCompletionReferralOutcome | undefined;
  readonly setOutcome: (
    outcome: ProfileCompletionReferralOutcome | undefined
  ) => void;
};

const ProfileCompletionReferralNoticeContext =
  createContext<ProfileCompletionReferralNoticeState | null>(null);

/**
 * Holds the referral outcome of a first-time completion in the account
 * layout, which survives the refresh that replaces the completion form with
 * the linked account.
 */
export function ProfileCompletionReferralNoticeProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [outcome, setOutcome] = useState<
    ProfileCompletionReferralOutcome | undefined
  >();
  return (
    <ProfileCompletionReferralNoticeContext.Provider
      value={{ outcome, setOutcome }}
    >
      {children}
    </ProfileCompletionReferralNoticeContext.Provider>
  );
}

/** Hands a completion's referral outcome to the linked account's notice. */
export function useShowProfileCompletionReferralNotice() {
  return useContext(ProfileCompletionReferralNoticeContext)?.setOutcome;
}

export const getProfileCompletionReferralMessage = (
  outcome: ProfileCompletionReferralOutcome,
  locale: Locale
) => {
  if (outcome.status === "applied") {
    return m.accountProfileReferralApplied(
      { discount: formatReferralInvitationDiscount(locale) },
      { locale }
    );
  }
  if (outcome.status === "pending") {
    return m.accountProfileReferralPending({}, { locale });
  }
  return {
    "already-referred": m.accountProfileReferralAlreadyReferred({}, { locale }),
    "not-eligible": m.accountProfileReferralNotEligible({}, { locale }),
    "code-unusable": m.accountProfileReferralCodeNotUsable({}, { locale }),
    "profile-already-completed":
      m.accountProfileReferralProfileAlreadyCompleted({}, { locale }),
  }[outcome.reason];
};

/**
 * Shows the completion's referral outcome once on the linked account: the
 * notice takes the outcome from the layout, so a later visit starts clean.
 */
export function ProfileCompletionReferralNotice({
  locale,
}: {
  readonly locale: Locale;
}) {
  const context = useContext(ProfileCompletionReferralNoticeContext);
  const [outcome, setOutcome] = useState(context?.outcome);
  const clearLayoutOutcome = context?.setOutcome;

  useEffect(() => {
    clearLayoutOutcome?.(undefined);
  }, [clearLayoutOutcome]);

  if (context?.outcome !== undefined && context.outcome !== outcome) {
    setOutcome(context.outcome);
  }

  return (
    <div role="status">
      {outcome && (
        <p
          className={`mb-6 rounded-2xl border px-4 py-3 text-sm leading-6 ${
            outcome.status === "applied"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-navy-blue/12 bg-white/92 text-navy-blue"
          }`}
        >
          {getProfileCompletionReferralMessage(outcome, locale)}
        </p>
      )}
    </div>
  );
}
