import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

/**
 * One person coming to a private office: their avatar, who they are, a
 * "You" tag on the contact's row, and a remove button where the list is
 * still editable.
 */
export function OfficePersonRow({
  avatar,
  children,
  contactRow = false,
  onRemove,
  removeLabel,
  tag,
}: {
  readonly avatar: ReactNode;
  readonly children: ReactNode;
  readonly contactRow?: boolean;
  /** Removes the person; a disabled button when they must stay. */
  readonly onRemove?: () => void;
  /** Set on an editable list, which shows the remove button. */
  readonly removeLabel?: string;
  readonly tag?: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full text-base font-semibold",
          contactRow
            ? "bg-navy-blue text-white"
            : "bg-navy-blue/6 text-navy-blue"
        )}
      >
        {avatar}
      </span>
      <span className="min-w-0 flex-1 text-base leading-snug">{children}</span>
      {tag && (
        <span className="shrink-0 rounded-full bg-navy-blue/6 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/80">
          {tag}
        </span>
      )}
      {removeLabel && (
        <Button
          aria-label={removeLabel}
          className="shrink-0"
          disabled={!onRemove}
          onClick={onRemove}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-5" />
        </Button>
      )}
    </li>
  );
}

/** Up to two initials of a name, for the contact's avatar. */
export const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

/** Lets a long address wrap before its domain instead of mid-word. */
export const breakEmail = (email: string) => {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
};
