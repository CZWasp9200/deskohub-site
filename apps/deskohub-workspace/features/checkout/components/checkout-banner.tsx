import { AlertTriangle } from "lucide-react";
import { cn } from "@/shared/utils";

/** A checkout notice, or with an alert role the error of a failed action. */
export function CheckoutBanner({
  children,
  live = true,
  role,
}: {
  readonly children: string;
  /** False inside a live region the caller keeps mounted. */
  readonly live?: boolean;
  readonly role?: "alert";
}) {
  const announcement = role ? { role } : { "aria-live": "polite" as const };
  return (
    <p
      // A banner inserted after a failed action must use an alert role:
      // assistive technology may ignore a live region mounted with content.
      {...(live ? announcement : {})}
      className={cn(
        "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-6",
        "border-burned-orange/20 bg-burned-orange/8 text-burned-orange-ink"
      )}
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange"
      />
      <span>{children}</span>
    </p>
  );
}
