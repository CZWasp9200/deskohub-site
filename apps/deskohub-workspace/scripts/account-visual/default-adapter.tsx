import { testEmailAddress } from "@deskohub/email/testing";
import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { AccountVisualRoute } from "./account-route";
import type { AccountVisualAdapterProps } from "./types";

const linkedFixture = {
  kind: "linked",
  email: testEmailAddress("ada"),
  profile: {
    firstName: "Ada",
    lastName: "Example",
    phone: null,
    billing: null,
  },
  avatar: { kind: "available", avatar: null },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
} as const satisfies CustomerAccountPageState;

export { defaultAccountVisualAdapterMetadata as accountVisualAdapterMetadata } from "./types";
export { linkedFixture as accountVisualFixture };

export default function DefaultAccountAdapter({
  locale,
}: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={linkedFixture} />
    </AccountLayoutShell>
  );
}
