"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { signOutSucceeded } from "@/features/account/sign-out-result";
import { m } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const locale = useLocale();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutFailed(false);
    const result = await authClient.signOut().catch(() => undefined);
    if (!signOutSucceeded(result)) {
      // The session may still be valid, so the customer stays here to retry.
      setSigningOut(false);
      setSignOutFailed(true);
      return;
    }
    router.push(getLocalizedHref("/", locale));
    router.refresh();
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={signingOut}
        onClick={handleSignOut}
        className="border-gray-600 bg-transparent text-white hover:bg-gray-800 hover:text-white"
      >
        <LogOut aria-hidden />
        {m["account.signOut"]()}
      </Button>
      <p role="alert" className="mt-2 text-sm text-red-400 empty:mt-0">
        {signOutFailed ? m["account.signOutFailed"]() : null}
      </p>
    </div>
  );
}
