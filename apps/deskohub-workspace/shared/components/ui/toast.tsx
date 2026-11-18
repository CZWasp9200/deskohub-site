import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

type ToastProps = {
  /** The confirmation to show; nothing while it is closed. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly open: boolean;
};

/**
 * A short confirmation pinned to the bottom of the screen, such as "Address
 * copied.", in the mobile app's confirmation toast look. The status region
 * stays mounted so screen readers announce each message; the caller closes it
 * after a moment, for example from `useClipboardCopy`'s status.
 */
export function Toast({ children, className, open }: ToastProps) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex justify-center",
        className
      )}
      data-toast=""
      role="status"
    >
      {open && (
        <div className="flex w-full max-w-md items-center gap-3 rounded-[14px] bg-[#00513E] px-5 py-4 text-base font-medium text-white shadow-[0_18px_48px_-18px_rgba(0,2,79,0.55)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
          <CircleCheck
            aria-hidden="true"
            className="size-6 shrink-0 text-aquamarine-green"
          />
          <span className="min-w-0">{children}</span>
        </div>
      )}
    </div>
  );
}
