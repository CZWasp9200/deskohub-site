"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import { ProfileCompletionReferralNotice } from "@/features/account/components/profile-completion-referral-notice";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReferralScreen } from "@/features/account/components/referral-screen";
import { ReservationHistory } from "@/features/account/components/reservation-history";
import type {
  CustomerAvatarPresentation,
  CustomerReservationHistory,
  ProfileCompletionReferralOutcome,
} from "@/features/account/contracts";
import { getAccountPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import {
  formatReferralDiscount,
  formatReferralDiscountReduction,
} from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";

type LinkedAccountProps = {
  readonly email: string;
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
  readonly profile: CustomerProfile;
  readonly avatarPresentation: CustomerAvatarPresentation;
  /** Whether the referral program is released; withheld, nothing shows. */
  readonly referralsEnabled: boolean;
  readonly referrals?: ReferralAccountOverview;
  readonly signupReferral?: ProfileCompletionReferralOutcome;
};

export function LinkedAccount({
  avatarPresentation,
  email,
  history,
  locale,
  profile,
  referrals,
  referralsEnabled,
  signupReferral,
}: LinkedAccountProps) {
  const pathname = usePathname();
  const {
    activeSection,
    changeSection,
    setReferralBadge,
    setReservationCount,
  } = useAccountLayout();
  const normalizedPathname =
    pathname === null ? null : pathname.replace(/\/+$/, "") || "/";
  const isPrivateAccountPathname =
    normalizedPathname === getAccountPath(locale);
  const profileSection = activeSection === "billing" ? "billing" : "profile";
  const copy = getAccountScreenCopy(locale);
  const reservationCount =
    history.kind === "available" ? history.groups.current.length : undefined;

  const referralDiscount = referralsEnabled
    ? referrals?.summary.discount
    : undefined;
  const showReferralBadge =
    referralDiscount !== undefined && referralDiscount !== "0";
  const referralBadgeText = showReferralBadge
    ? formatReferralDiscountReduction(referralDiscount, locale)
    : undefined;
  const referralBadgeLabel = showReferralBadge
    ? m.accountReferralsNavigationBadgeLabel(
        { discount: formatReferralDiscount(referralDiscount, locale) },
        { locale }
      )
    : undefined;

  useEffect(() => {
    setReservationCount(reservationCount);
    return () => setReservationCount(undefined);
  }, [reservationCount, setReservationCount]);

  // Depend on the strings, not a badge object, so publishing it cannot loop.
  useEffect(() => {
    setReferralBadge(
      referralBadgeText === undefined || referralBadgeLabel === undefined
        ? undefined
        : { text: referralBadgeText, label: referralBadgeLabel }
    );
    return () => setReferralBadge(undefined);
  }, [referralBadgeLabel, referralBadgeText, setReferralBadge]);

  return (
    <>
      {referralsEnabled && (
        <ProfileCompletionReferralNotice
          locale={locale}
          outcome={signupReferral}
        />
      )}

      <div hidden={activeSection !== "reservations"}>
        <ReservationHistory
          copy={copy.reservations}
          history={history}
          locale={locale}
        />
      </div>

      {referralsEnabled && (
        <div hidden={activeSection !== "referrals"}>
          <ReferralScreen locale={locale} referrals={referrals} />
        </div>
      )}

      <div hidden={activeSection !== "profile" && activeSection !== "billing"}>
        <ProfileForm
          avatarPresentation={avatarPresentation}
          email={email}
          locale={locale}
          mode="edit"
          onSectionChange={changeSection}
          profile={profile}
          section={profileSection}
        />
      </div>

      {activeSection === "legal" && isPrivateAccountPathname && (
        <LegalScreen locale={locale} />
      )}

      <div hidden={activeSection !== "danger"}>
        <DeleteAccountCard
          deletionPending={false}
          email={email}
          heading={copy.dangerTitle}
          locale={locale}
        />
      </div>
    </>
  );
}
