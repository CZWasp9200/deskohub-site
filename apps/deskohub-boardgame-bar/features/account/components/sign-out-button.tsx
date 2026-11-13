"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { m } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const locale = useLocale();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await authClient.signOut().catch(() => undefined);
    router.push(getLocalizedHref("/", locale));
    router.refresh();
  }

  return (
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
  );
}
