"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { customerMcpServerUrl } from "@/features/account/customer-agent-routes";
import { getLocalizedPagePath, type Locale, m } from "@/features/i18n";
import {
  type ClipboardCopyStatus,
  useClipboardCopy,
} from "@/shared/browser/use-clipboard-copy";
import Sparkle from "@/shared/components/icons/sparkle";
import { Button } from "@/shared/components/ui/button";
import { DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils";
import {
  agentBookingAssistants,
  getAgentBookingInstruction,
  getAssistantChatUrl,
  getAssistantName,
} from "../agent-booking-assistants";
import { AssistantMark } from "./assistant-marks";

/**
 * The picker's body inside a dialog or sheet: one tile per assistant, the
 * copy actions for any other agent, and the AI assistants guide.
 */
export function AgentBookingPickerContent({ locale }: { locale: Locale }) {
  const instruction = getAgentBookingInstruction(locale);
  const [announcement, setAnnouncement] = useState("");

  return (
    <>
      <div className="flex items-center gap-2 pr-10">
        <Sparkle className="size-4.5 shrink-0 text-sunset-yellow" />
        <DialogTitle className="pr-0 text-xs uppercase tracking-[0.14em] text-burned-orange">
          {m.agentBookingPickerTitle({}, { locale })}
        </DialogTitle>
      </div>
      <ul className="mt-6 grid grid-cols-3 gap-2 sm:gap-2.5">
        {agentBookingAssistants.map((assistant) => {
          const name = getAssistantName(assistant);
          return (
            <li key={assistant}>
              <a
                aria-label={m.agentBookingOpenInAssistant(
                  { assistant: name },
                  { locale }
                )}
                className="flex h-full flex-col items-center gap-2 rounded-[0.875rem] bg-white px-0.5 pt-3.5 pb-3 text-[0.8125rem] text-navy-blue ring-1 ring-navy-blue/7 transition-shadow hover:ring-burned-orange/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange sm:text-sm"
                href={getAssistantChatUrl(assistant, instruction)}
                rel="noopener"
                target="_blank"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-[#f3f1ec] sm:size-11">
                  <AssistantMark assistant={assistant} className="size-6" />
                </span>
                {name}
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <CopyPill
          labels={{
            idle: m.agentBookingCopyInstruction({}, { locale }),
            copied: m.agentBookingInstructionCopied({}, { locale }),
            failed: m.agentBookingCopyFailed({}, { locale }),
          }}
          onCopied={setAnnouncement}
          text={instruction}
        />
        <CopyPill
          labels={{
            idle: m.agentBookingCopyMcpServerUrl({}, { locale }),
            copied: m.agentBookingMcpServerUrlCopied({}, { locale }),
            failed: m.agentBookingCopyFailed({}, { locale }),
          }}
          onCopied={setAnnouncement}
          text={customerMcpServerUrl}
        />
        <Link
          className="text-sm text-navy-blue/75 underline underline-offset-[3px] transition-colors hover:text-burned-orange focus-visible:text-burned-orange sm:ml-auto"
          href={getLocalizedPagePath(locale, "/[locale]/ai-assistants")}
        >
          {m.agentBookingHowItWorks({}, { locale })}
        </Link>
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </>
  );
}

const copyStatuses = ["idle", "copied", "failed"] as const;

/**
 * Copies `text` and shows the outcome in place for a moment. Every label
 * takes the same cell, so the pill keeps the width of its longest one.
 */
function CopyPill({
  labels,
  onCopied,
  text,
}: {
  labels: Readonly<Record<ClipboardCopyStatus, string>>;
  onCopied: (announcement: string) => void;
  text: string;
}) {
  const { status, copy } = useClipboardCopy();
  const StatusIcon = status === "copied" ? Check : Copy;

  return (
    <Button
      caps
      onClick={async () => onCopied(labels[await copy(text)])}
      shape="pill"
      size="sm"
      tone={
        (
          {
            idle: "tinted",
            copied: "tinted-success",
            failed: "danger",
          } as const
        )[status]
      }
      type="button"
      variant="ghost"
      wrap
    >
      <StatusIcon aria-hidden className="size-4 shrink-0" />
      <span className="grid">
        {copyStatuses.map((labelStatus) => (
          <span
            aria-hidden={labelStatus !== status}
            className={cn(
              "col-start-1 row-start-1",
              labelStatus !== status && "invisible"
            )}
            key={labelStatus}
          >
            {labels[labelStatus]}
          </span>
        ))}
      </span>
    </Button>
  );
}
