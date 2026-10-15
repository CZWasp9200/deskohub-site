"use client";

import { Eye } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import type { CampaignComposerTemplate } from "./campaign-composer";

/** Shows a template rendered with sample content. */
export function CampaignTemplatePreview({
  template,
}: {
  readonly template: CampaignComposerTemplate;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="secondary">
          <Eye aria-hidden className="size-4" />
          Preview template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>
        <iframe
          className="mt-4 h-[70vh] w-full rounded-lg border border-navy-blue/10 bg-white"
          sandbox=""
          srcDoc={template.previewHtml}
          title={`${template.name} template with sample content`}
        />
      </DialogContent>
    </Dialog>
  );
}
