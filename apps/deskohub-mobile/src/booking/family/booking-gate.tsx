import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";
import type { AccountNotice } from "../../account/account-gating";
import { reservationsAccess, tabGate } from "../../account/account-gating";
import { TabGateCard } from "../../account/tab-gate-card";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Notice } from "../../ui/notice";
import { opensWithoutAccount } from "./booking-family-view";

const unavailableNotice = (notice: AccountNotice, locale: AppLocale) =>
  ({
    "completion-required": m.account_notice_completion_required,
    "support-required": m.account_notice_support_required,
    unavailable: m.account_notice_unavailable,
    "deletion-pending": m.account_notice_deletion_pending,
  })[notice]({}, { locale });

/**
 * Shows `children` only to an account that can book, as the Reservations
 * tab gates its rows: an account without a profile gets the card that sends
 * it to complete it, an account being deleted the card that says it is
 * blocked, any other account sees why it can't book. When the account can't be read
 * because it spent its read budget, `children` show under that notice: the
 * checkout still checks the account.
 */
export function BookingGate({ children }: { readonly children: ReactNode }) {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  if (opensWithoutAccount(account)) {
    return (
      <>
        <Notice
          tone="warning"
          message={m.account_error_rate_limited({}, { locale })}
        />
        {children}
      </>
    );
  }
  return (
    <AsyncView result={account} onRetry={refresh}>
      {(current) => {
        const access = reservationsAccess(current);
        const gate = tabGate("book", access);
        if (gate !== undefined)
          return <TabGateCard gate={gate} onRetry={refresh} />;
        return access.kind === "unavailable" ? (
          <Notice
            tone="warning"
            message={unavailableNotice(access.notice, locale)}
          />
        ) : (
          children
        );
      }}
    </AsyncView>
  );
}
