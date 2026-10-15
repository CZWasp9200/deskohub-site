"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { useForm } from "react-hook-form";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  campaignLinkHrefHint,
  normalizeCampaignLinkHref,
} from "./campaign-link-href";

export type CtaButtonValues = {
  readonly label: string;
  readonly href: string;
};

const CtaButtonFields = Schema.Struct({
  label: Schema.String.check(
    Schema.makeFilter(
      (label) => label.trim().length > 0 || "Enter the button text."
    )
  ),
  href: Schema.String.check(
    Schema.makeFilter(
      (href) =>
        normalizeCampaignLinkHref(href) !== undefined || campaignLinkHrefHint
    )
  ),
});

/** Inserts or edits a call-to-action button: its text and where it links. */
export function CtaButtonDialog({
  initialValues,
  onOpenChange,
  onRemove,
  onSubmit,
  open,
}: {
  /** Set when editing an existing button. */
  readonly initialValues?: CtaButtonValues;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemove?: () => void;
  readonly onSubmit: (values: CtaButtonValues) => void;
  readonly open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initialValues ? "Edit button" : "Insert button"}
          </DialogTitle>
          <DialogDescription>
            A prominent button that links to a page or an email address.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CtaButtonForm
            initialValues={initialValues}
            onCancel={() => onOpenChange(false)}
            onRemove={onRemove}
            onSubmit={(values) => {
              onSubmit(values);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CtaButtonForm({
  initialValues,
  onCancel,
  onRemove,
  onSubmit,
}: {
  readonly initialValues: CtaButtonValues | undefined;
  readonly onCancel: () => void;
  readonly onRemove: (() => void) | undefined;
  readonly onSubmit: (values: CtaButtonValues) => void;
}) {
  const form = useForm<
    typeof CtaButtonFields.Encoded,
    unknown,
    typeof CtaButtonFields.Type
  >({
    resolver: effectSchemaResolver(CtaButtonFields),
    defaultValues: initialValues ?? { label: "", href: "" },
  });

  return (
    <Form {...form}>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          // The dialog portals out of the composer form, but React still
          // bubbles submit events through the component tree.
          event.stopPropagation();
          return form.handleSubmit(({ label, href }) =>
            onSubmit({
              label: label.trim(),
              href: normalizeCampaignLinkHref(href) ?? href,
            })
          )(event);
        }}
      >
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Button text</FormLabel>
              <FormControl>
                <Input placeholder="Book a desk" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="href"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Link</FormLabel>
              <FormControl>
                <Input
                  inputMode="url"
                  placeholder="https://workspace.deskohub.cz"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          {onRemove && (
            <Button
              className="sm:mr-auto"
              onClick={onRemove}
              size="sm"
              type="button"
              variant="ghost"
            >
              Remove button
            </Button>
          )}
          <Button
            onClick={onCancel}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button size="sm" type="submit">
            {initialValues ? "Update button" : "Insert button"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
