import { Stack } from "expo-router";
import { ReservationsRefreshRoot } from "../../src/account/reservations/reservations-refresh-root";
import { useAuthSession } from "../../src/auth/use-auth-session";
import { AccountConsentSyncRoot } from "../../src/consent/account-consent-sync-root";
import { CustomerDataProvider } from "../../src/customer-api/customer-data-provider";

/**
 * The signed-in app over the signed-in account's own data registry: the
 * `/` start-tab redirect, the Account, Book and Reservations tabs, and
 * booking a space (`book/`) and a reservation's access PIN
 * (`reservations/`) stacked above them so they stay out of the tab bar.
 * The Stack registers routes it doesn't declare, so `index`, `book/` and
 * `reservations/` need no screen here. The device's analytics consent follows the
 * account while the group is mounted, and the account's reservations are
 * read once per launch (`ReservationsRefreshRoot`).
 */
export default function AccountLayout() {
  const session = useAuthSession();
  // The root guard mounts this group only while signed in.
  const accountId = session.status === "signed-in" ? session.user.id : "";
  const sessionStartedAt =
    session.status === "signed-in" ? session.signedInAt.getTime() : 0;
  return (
    <CustomerDataProvider
      accountId={accountId}
      sessionStartedAt={sessionStartedAt}
    >
      <AccountConsentSyncRoot accountId={accountId} />
      <ReservationsRefreshRoot />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </CustomerDataProvider>
  );
}
