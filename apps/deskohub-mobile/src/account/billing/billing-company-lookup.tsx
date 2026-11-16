import type { AppLocale } from "../../i18n/app-locale";
import type { ProfileDraft } from "../profile/profile-draft";

/**
 * The company lookup by IČO under the Company ID field (board 13b). Nothing
 * shows yet: ticket #1254 builds the lookup here, over the customer API's
 * company lookup, and applies the found details with `onApply`, which
 * changes the draft like typing does.
 */
export function BillingCompanyLookup(_props: {
  readonly draft: ProfileDraft;
  readonly onApply: (change: Partial<ProfileDraft>) => void;
  readonly disabled: boolean;
  readonly locale: AppLocale;
}) {
  return null;
}
