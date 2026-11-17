import type { AutomationRunSummary } from "@deskohub/workspace-admin-api";
import { AdministrationLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  inactiveCustomerDisplayNames,
  isInactiveAdministrationCustomer,
} from "@/features/administration/customer-name";
import { AdministrationCustomerNameLabel } from "@/features/administration/customer-name-label";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { AutomationRunSummaryWithLifecycle } from "../../../automation/backend/automation-run-log.service";

/** The admin page of a run's Dotypos customer. */
const automationRunCustomerHref = (run: AutomationRunSummary) =>
  administrationHref("/[locale]/admin/customers/[customerId]", {
    customerId: run.customerId,
  });

/** Whether Dotypos couldn't be read for any of `runs`' customers. */
export const automationRunContactsUnavailable = (
  runs: readonly AutomationRunSummary[]
) => runs.some((run) => run.customerProfileStatus === "unavailable");

/** An email that wraps before its domain rather than mid-word. */
function EmailAddress({ email }: { readonly email: string }) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

/** The run's customer's ID, in small monospace under a name. */
function CustomerId({ run }: { readonly run: AutomationRunSummary }) {
  return (
    <span className="font-mono text-navy-blue/60 text-xs">
      {run.customerId}
    </span>
  );
}

/**
 * A run's customer: the current name over the email, linking to the
 * customer. A deleted or expired customer shows the administration
 * placeholder instead, unlinked since it has no customer page. Without a
 * name or email, the Dotypos ID, with a quiet note when the profile wasn't
 * found or couldn't be read; `showId` adds the ID under a name too.
 */
export function AutomationRunCustomer({
  locale,
  run,
  showId = false,
}: {
  readonly locale: Locale;
  readonly run: AutomationRunSummaryWithLifecycle;
  readonly showId?: boolean;
}) {
  const customer = { lifecycle: run.customerLifecycle };
  if (isInactiveAdministrationCustomer(customer)) {
    return (
      <div className="grid min-w-0 gap-0.5">
        <AdministrationCustomerNameLabel
          customer={{
            displayName: inactiveCustomerDisplayNames[customer.lifecycle],
            hasName: false,
            lifecycle: customer.lifecycle,
          }}
          locale={locale}
        />
        {showId && <CustomerId run={run} />}
      </div>
    );
  }
  const title = run.customerName ?? run.customerEmail;
  if (run.customerProfileStatus !== "found" || title === null) {
    return (
      <div className="grid gap-0.5">
        <AdministrationLink
          className="w-fit font-mono text-xs underline underline-offset-4"
          href={automationRunCustomerHref(run)}
        >
          {run.customerId}
        </AdministrationLink>
        {run.customerProfileStatus !== "found" && (
          <span className="text-navy-blue/60 text-xs">
            {run.customerProfileStatus === "unavailable"
              ? m.emailAutomationRunsCustomerProfileUnavailable({}, { locale })
              : m.emailAutomationRunsCustomerProfileNotFound({}, { locale })}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-0.5">
      <AdministrationLink
        className="w-fit font-semibold underline underline-offset-4"
        href={automationRunCustomerHref(run)}
      >
        {title}
      </AdministrationLink>
      {run.customerName !== null && run.customerEmail !== null && (
        <span className="break-words text-navy-blue/65 text-xs">
          <EmailAddress email={run.customerEmail} />
        </span>
      )}
      {showId && <CustomerId run={run} />}
    </div>
  );
}
