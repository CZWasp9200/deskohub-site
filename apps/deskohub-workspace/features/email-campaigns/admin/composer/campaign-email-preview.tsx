"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import { previewCampaignEmail } from "./actions";
import {
  type CampaignComposerLocaleFields,
  hasLocaleContent,
  toCampaignLocaleContent,
} from "./campaign-composer-fields";

const previewDelayMs = 500;

const localeLabels: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech",
  "en-US": "English",
};

/**
 * The unsaved locale content rendered through the campaign template, as a
 * recipient's inbox would show it.
 */
export function CampaignEmailPreview({
  fields,
  locale,
  locales,
  onLocaleChange,
  purpose,
  templateKey,
}: {
  readonly fields: CampaignComposerLocaleFields;
  readonly locale: Locale;
  readonly locales: readonly Locale[];
  readonly onLocaleChange: (locale: Locale) => void;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
}) {
  const [preview, setPreview] = useState<{
    readonly html: string;
    readonly subject: string;
    readonly preheader: string;
  }>();
  const [error, setError] = useState<string>();
  const hasContent = hasLocaleContent(fields);
  const request = {
    templateKey,
    purpose,
    locale,
    content: toCampaignLocaleContent(fields, purpose),
  };
  const requestKey = JSON.stringify(request);
  const latestRequestKey = useRef(requestKey);
  latestRequestKey.current = requestKey;

  const render = useWorkspaceAction(previewCampaignEmail, {
    actionName: "previewCampaignEmail",
    onSuccess: ({ data, input }) => {
      if (JSON.stringify(input) !== latestRequestKey.current) return;
      setError(undefined);
      setPreview({
        html: data.html,
        subject: data.subject,
        preheader: input.content.preheader,
      });
    },
    onError: ({ error }) =>
      setError(error.serverError ?? "The preview could not be rendered."),
  });
  // The hook returns a new `execute` on every render, including the renders
  // its own pending state causes; a ref keeps those from rescheduling.
  const execute = useRef(render.execute);
  execute.current = render.execute;

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestKey captures the request.
  useEffect(() => {
    if (!hasContent) return;
    const timer = setTimeout(() => execute.current(request), previewDelayMs);
    return () => clearTimeout(timer);
  }, [requestKey, hasContent]);

  return (
    <section
      aria-label="Email preview"
      className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-navy-blue/10 border-b px-4 py-2.5">
        <h2 className="font-semibold text-navy-blue/65 text-xs uppercase tracking-[0.1em]">
          Preview
        </h2>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-navy-blue/55 text-xs"
            role="status"
          >
            {render.isExecuting && (
              <>
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Updating…
              </>
            )}
          </span>
          {locales.length > 1 && (
            <ToggleGroup
              aria-label="Preview language"
              onValueChange={(value) =>
                value && onLocaleChange(value as Locale)
              }
              type="single"
              value={locale}
            >
              {locales.map((option) => (
                <ToggleGroupItem key={option} value={option}>
                  {localeLabels[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      </div>
      <div className="flex items-start gap-3 border-navy-blue/10 border-b bg-navy-blue/[0.02] px-4 py-3">
        <div
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-blue font-semibold text-sm text-white"
        >
          D
        </div>
        <div className="min-w-0">
          <p className="text-navy-blue/60 text-xs">Deskohub</p>
          <p className="truncate font-semibold text-sm">
            {fields.subject.trim() || (
              <span className="text-navy-blue/40 italic">No subject</span>
            )}
          </p>
          <p className="truncate text-navy-blue/55 text-sm">
            {fields.preheader.trim() || (
              <span className="italic">No preview text</span>
            )}
          </p>
        </div>
      </div>
      <p
        className="border-burned-orange/20 border-b bg-burned-orange/5 px-4 py-2 text-burned-orange-ink text-sm empty:hidden"
        role="alert"
      >
        {error}
      </p>
      {hasContent && preview ? (
        <iframe
          className="h-[40rem] @5xl:h-[calc(100vh-17rem)] @5xl:min-h-[32rem] w-full bg-white"
          sandbox=""
          srcDoc={preview.html}
          title={`Email preview, ${localeLabels[locale]}`}
        />
      ) : (
        <div className="flex h-[40rem] @5xl:h-[calc(100vh-17rem)] @5xl:min-h-[32rem] items-center justify-center px-8 text-center text-navy-blue/55 text-sm">
          {hasContent
            ? "Rendering the preview…"
            : `Add ${localeLabels[locale]} content to see the email.`}
        </div>
      )}
    </section>
  );
}
