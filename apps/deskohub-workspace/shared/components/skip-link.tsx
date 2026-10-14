import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

export function SkipLink({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="secondary"
      className={cn(
        "fixed left-4 top-4 z-[100] -translate-y-24 focus:translate-y-0",
        className
      )}
    >
      <a href="#main-content">{label}</a>
    </Button>
  );
}
