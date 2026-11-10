"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { type ReactNode, Suspense, use } from "react";
import { GuardedLink as Link } from "@/shared/components/guarded-link";
import type { SiteHeaderAdministratorEntry } from "@/shared/components/site-header-config";
import { Button } from "@/shared/components/ui/button";

type AdministratorEntryProps = {
  readonly entry: SiteHeaderAdministratorEntry;
  readonly onNavigate?: () => void;
};

function WhenAdministrator({
  entry,
  children,
}: {
  readonly entry: SiteHeaderAdministratorEntry;
  readonly children: ReactNode;
}) {
  return use(entry.visible) && children;
}

/** Renders only once the server confirms an administrator; nothing before. */
function AdministratorOnly(props: {
  readonly entry: SiteHeaderAdministratorEntry;
  readonly children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <WhenAdministrator {...props} />
    </Suspense>
  );
}

/**
 * The filled Admin button beside the account control. Beside the desktop
 * navigation, from `xl` to `2xl`, it keeps only its icon, like the language
 * menu button, so the navigation labels stay on one line.
 */
export function AdministratorEntryButton({
  entry,
  onNavigate,
}: AdministratorEntryProps) {
  return (
    <AdministratorOnly entry={entry}>
      <Button
        asChild
        variant="primary"
        tone="chilean-fire"
        size="sm"
        caps
        // The size's padding is wider than the narrowed box; the button centres
        // its one remaining item, the icon, across it.
        className="hidden shrink-0 md:inline-flex xl:max-2xl:w-9"
      >
        <Link href={entry.href} title={entry.label} onClick={onNavigate}>
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span className="xl:max-2xl:sr-only">{entry.label}</span>
        </Link>
      </Button>
    </AdministratorOnly>
  );
}

/** The full-width Admin button at the top of the mobile menu. */
export function AdministratorEntryMenuButton({
  entry,
  onNavigate,
}: AdministratorEntryProps) {
  return (
    <AdministratorOnly entry={entry}>
      <Button
        asChild
        variant="primary"
        tone="chilean-fire"
        size="xl"
        caps
        fullWidth
      >
        <Link href={entry.href} onClick={onNavigate}>
          <ShieldCheck className="size-5" aria-hidden />
          {entry.label}
          <ArrowRight className="ml-auto size-5" aria-hidden />
        </Link>
      </Button>
    </AdministratorOnly>
  );
}
