import { KeyRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

/**
 * How the button opens the access page: `guarded` and `client` navigate in
 * the app (`guarded` through `GuardedLink`), `document` loads it as a page.
 */
export type ReservationAccessNavigation = "guarded" | "client" | "document";

/**
 * The reservation's main action: open its door PIN. One button for every
 * web surface, primary with a key icon like the app's PIN button. Without
 * `href` it renders disabled with `unavailableNote` under it.
 */
export function ReservationAccessButton({
  className,
  href,
  id,
  locale,
  navigation = "guarded",
  size = "sm",
  unavailableNote,
}: {
  readonly className?: string;
  readonly href: string | undefined;
  readonly id?: string;
  readonly locale: Locale;
  readonly navigation?: ReservationAccessNavigation;
  readonly size?: "sm" | "lg";
  readonly unavailableNote?: ReactNode;
}) {
  const label = (
    <>
      <KeyRound aria-hidden="true" className="size-4 shrink-0" />
      {m.accountReservationShowPinCode({}, { locale })}
    </>
  );

  if (!href) {
    return (
      <div className="min-w-0">
        <Button
          className={className}
          disabled
          fullWidth
          size={size}
          type="button"
          variant="primary"
          wrap
        >
          {label}
        </Button>
        {unavailableNote && (
          <p className="mt-2 max-w-sm break-words text-xs leading-5 text-[#64748b]">
            {unavailableNote}
          </p>
        )}
      </div>
    );
  }

  return (
    <Button
      asChild
      className={cn(className)}
      fullWidth
      size={size}
      variant="primary"
      wrap
    >
      {navigation === "document" ? (
        <a href={href} id={id}>
          {label}
        </a>
      ) : navigation === "client" ? (
        <Link href={href} id={id} prefetch={false}>
          {label}
        </Link>
      ) : (
        <GuardedLink href={href} id={id}>
          {label}
        </GuardedLink>
      )}
    </Button>
  );
}
