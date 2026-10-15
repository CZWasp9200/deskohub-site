import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

export interface EmailVerificationStatusCopy {
  readonly verified: string;
  readonly unverified: string;
}

export function EmailVerificationStatus({
  copy,
  emailVerified,
}: {
  readonly copy: EmailVerificationStatusCopy;
  readonly emailVerified: boolean;
}) {
  const status = (
    {
      verified: {
        tone: "success",
        copy: copy.verified,
        Icon: CircleCheck,
      },
      unverified: {
        tone: "warning",
        copy: copy.unverified,
        Icon: CircleAlert,
      },
    } as const
  )[emailVerified ? "verified" : "unverified"];
  const Icon = status.Icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={status.copy}
            className="shrink-0"
            size="icon-sm"
            tone={status.tone}
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          collisionPadding={16}
          className="w-[min(22rem,calc(100vw-2rem))] break-words whitespace-normal"
        >
          {status.copy}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
