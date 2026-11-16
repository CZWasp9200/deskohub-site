import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { useToast } from "../ui/toast";
import { wholeAddress } from "../ui/whole-address";
import type { AuthSessionState } from "./auth-session-state";
import { useAuthSession } from "./use-auth-session";

/** Where the session last settled: `restoring` never counts. */
export type SettledSession = "unknown" | "signed-out" | "signed-in";

/**
 * Follows the session to its next settled place and says whether the app
 * just arrived signed in: from signed out, never from the launch's restore,
 * and never while it stays signed in (a reauthentication, a refreshed
 * session).
 */
export const followSettledSession = (
  last: SettledSession,
  session: AuthSessionState
): { readonly settled: SettledSession; readonly arrived: boolean } => {
  if (session.status === "restoring") return { settled: last, arrived: false };
  return {
    settled: session.status,
    arrived: last === "signed-out" && session.status === "signed-in",
  };
};

/**
 * Confirms who is signed in once a sign-in lands, whichever way it came
 * (email, passkey or a magic link). Mounted once under the toast provider;
 * the app only, since the web page the app opens for its sign-in hands the
 * session on instead.
 */
export function SignedInToast() {
  const locale = useAppLocale();
  const session = useAuthSession();
  const toast = useToast();
  const settled = useRef<SettledSession>("unknown");
  const email = session.status === "signed-in" ? session.user.email : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: a session refetch is a new object; only its status and account matter.
  useEffect(() => {
    const next = followSettledSession(settled.current, session);
    settled.current = next.settled;
    if (next.arrived && Platform.OS !== "web") {
      toast.show({
        message: m.signin_signed_in_as(
          { email: wholeAddress(email) },
          { locale }
        ),
      });
    }
  }, [session.status, email]);

  return null;
}
