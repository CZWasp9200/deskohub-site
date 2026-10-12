import "server-only";

import { Effect, Result } from "effect";
import { cache } from "react";
import { acceptAutoLinkedReferral } from "@/features/account/backend/auto-linked-referral";
import { resolveCurrentCustomerAccount } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import type {
  CustomerAvatarPresentation,
  CustomerReservationHistory,
} from "@/features/account/contracts";
import { areAccountAvatarsEnabled } from "@/features/account/server/account-feature-flag.server";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import type { ReferralCode } from "@/features/referrals/client";
import type { ReferralAccountSummary } from "@/features/referrals/contracts";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * The closed set of account page states. Every state is derived from the
 * authoritative Better Auth session and the Dotypos link, never from the
 * proxy or cookies.
 */
export type CustomerAccountPageState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "authenticated-unavailable"; readonly email: string }
  | {
      readonly kind: "completion-required";
      readonly email: string;
      /** Invitation code to prefill, present only when currently usable. */
      readonly referralCode?: ReferralCode;
    }
  | {
      readonly kind: "linked";
      readonly email: string;
      readonly profile: CustomerProfile;
      readonly avatar: CustomerAvatarPresentation;
      readonly history: CustomerReservationHistory;
      readonly referrals?: ReferralAccountSummary;
    }
  | { readonly kind: "support-required"; readonly email: string }
  | { readonly kind: "deletion-pending"; readonly email: string };

const unavailable = (): CustomerAccountPageState => ({ kind: "unavailable" });

/**
 * Loads the account page for the current session. A shared referral code only
 * matters at sign-up: it prefills first-time profile completion, and it is
 * recorded when this visit links the account to an existing Dotypos customer.
 * An account that was already linked ignores it.
 */
export const loadCustomerAccountPage = cache(
  async (
    _locale: Locale,
    referralCode?: ReferralCode
  ): Promise<CustomerAccountPageState> => {
    const session = await Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    ).pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.tapError((error) =>
        Effect.logError("Account authentication failed", { error })
      ),
      Effect.result,
      runWorkspaceEffect("account.profile", { boundary: "page" })
    );
    if (Result.isFailure(session)) return unavailable();

    const user = session.success;
    if (!user) return { kind: "unauthenticated" };
    if (user.deletionRequested) {
      return { kind: "deletion-pending", email: user.email };
    }

    const resolution = await resolveCurrentCustomerAccount.pipe(
      Effect.tapError((error) =>
        Effect.logError("Account resolution failed", { error })
      ),
      Effect.result,
      runWorkspaceEffect("account.resolve", { boundary: "page" })
    );
    if (Result.isSuccess(resolution)) {
      const account = resolution.success.account;
      // Resolution has released the account lock that acceptance takes.
      await acceptAutoLinkedReferral(resolution.success, referralCode).pipe(
        Effect.provide(ReferralService.Live),
        Effect.catchCause(() =>
          logDegradedAccountSection("account.auto-link.referral.unavailable")
        ),
        runWorkspaceEffect("account.auto-link.referral", { boundary: "page" })
      );

      const profile = await Effect.flatMap(CustomerProfileService, (service) =>
        service.load(account)
      ).pipe(
        Effect.provide(CustomerProfileService.Live),
        Effect.tapError((error) =>
          Effect.logError("Account profile load failed", { error })
        ),
        Effect.result,
        runWorkspaceEffect("account.profile.read", { boundary: "page" })
      );
      if (Result.isFailure(profile)) {
        return { kind: "authenticated-unavailable", email: user.email };
      }

      const history = await Effect.flatMap(
        CustomerReservationHistoryService,
        (service) => service.load(account)
      ).pipe(
        Effect.provide(CustomerReservationHistoryService.Live),
        Effect.tapError(() =>
          logDegradedAccountSection("account.reservation-history.unavailable")
        ),
        Effect.orElseSucceed(
          () =>
            ({ kind: "unavailable", reason: "provider-unavailable" }) as const
        ),
        runWorkspaceEffect("account.reservation-history", {
          boundary: "page",
        })
      );

      let avatar: CustomerAvatarPresentation = { kind: "hidden" };
      if (await areAccountAvatarsEnabled().catch(() => false)) {
        // A media outage never blocks the account page: an avatar read failure
        // degrades to the initials fallback.
        const availableAvatar = await Effect.flatMap(
          CustomerAvatarService,
          (service) => service.lookup(account.accountId)
        ).pipe(
          Effect.provide(CustomerAvatarService.Live),
          Effect.tapError(() =>
            logDegradedAccountSection("account.avatar.unavailable")
          ),
          Effect.orElseSucceed(() => null),
          runWorkspaceEffect("account.avatar", { boundary: "page" })
        );
        avatar = { kind: "available", avatar: availableAvatar };
      }

      const referrals = await Effect.flatMap(ReferralService, (service) =>
        service.getAccountSummary({
          customerAccountId: account.accountId,
          dotyposCustomerId: account.dotyposCustomerId,
        })
      ).pipe(
        Effect.provide(ReferralService.Live),
        Effect.orElseSucceed(() => undefined),
        runWorkspaceEffect("account.referrals", { boundary: "page" })
      );

      return {
        kind: "linked",
        email: user.email,
        profile: profile.success,
        avatar,
        history,
        referrals,
      };
    }

    const failure = resolution.failure;
    if (failure.reason === "unauthenticated") {
      return { kind: "unauthenticated" };
    }
    if (
      failure.reason === "link-required" &&
      failure.linkReason === "not-found"
    ) {
      const availableReferralCode =
        referralCode === undefined
          ? undefined
          : await findAvailableReferralCode(referralCode);
      return {
        kind: "completion-required",
        email: user.email,
        ...(availableReferralCode && { referralCode: availableReferralCode }),
      };
    }
    if (
      failure.reason === "link-required" ||
      failure.reason === "unverified-email"
    ) {
      return { kind: "support-required", email: user.email };
    }
    return { kind: "authenticated-unavailable", email: user.email };
  }
);

/**
 * Read-only check of a shared code; an unusable code or a failed check leaves
 * the completion form without a prefill instead of blocking sign-up.
 */
const findAvailableReferralCode = (code: ReferralCode) =>
  Effect.flatMap(ReferralService, (service) =>
    service.findAvailableCode({ code })
  ).pipe(
    Effect.provide(ReferralService.Live),
    Effect.tapError(() =>
      logDegradedAccountSection("account.referral-code.unavailable")
    ),
    Effect.orElseSucceed(() => undefined),
    runWorkspaceEffect("account.referral-code", { boundary: "page" })
  );

/**
 * Records a degraded, non-blocking account section with a fixed, non-PII
 * code; the provider or database cause is never attached.
 */
const logDegradedAccountSection = (code: string) =>
  Effect.logWarning("Account page section unavailable").pipe(
    Effect.annotateLogs({ code })
  );
