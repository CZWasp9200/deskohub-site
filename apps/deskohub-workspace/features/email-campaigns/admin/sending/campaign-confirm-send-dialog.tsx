"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AdministrationAlert } from "@/features/administration/notice";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type { CampaignId } from "../../campaign-identifiers";
import { sendCampaign } from "./actions";
import { confirmationCodeFieldSchema } from "./contracts";

const emptyCodeField = { code: "" };

export function CampaignConfirmSendDialog({
  campaignId,
  unsavedChanges,
}: {
  readonly campaignId: CampaignId;
  readonly unsavedChanges: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    typeof confirmationCodeFieldSchema.Encoded,
    unknown,
    typeof confirmationCodeFieldSchema.Type
  >({
    defaultValues: emptyCodeField,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(confirmationCodeFieldSchema),
  });
  const { execute, isExecuting } = useWorkspaceAction(sendCampaign, {
    actionName: "sendCampaign",
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? "The campaign could not be sent. Try again."
      ),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setError(null);
        form.reset(emptyCodeField);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button">
          <Send aria-hidden className="size-4" />
          Send campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send this campaign</DialogTitle>
          <DialogDescription>
            Type the confirmation code from the latest test email. The code
            works for 24 hours and only for the content that test showed. A
            newer test send or a content change replaces it.
          </DialogDescription>
        </DialogHeader>
        {unsavedChanges && (
          <AdministrationAlert className="mt-5" status="warning">
            Save your changes and send a new test first. The campaign sends
            only saved content.
          </AdministrationAlert>
        )}
        <Form {...form}>
          <form
            className="mt-5"
            noValidate
            onSubmit={(event) => {
              void form.handleSubmit(({ code }) => {
                setError(null);
                execute({ campaignId, confirmationCode: code });
              })(event);
            }}
          >
            <FormField
              control={form.control}
              name="code"
              render={({ field: { onChange, ...field }, fieldState }) => (
                <FormItem>
                  <FormLabel>Confirmation code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoCapitalize="characters"
                      autoComplete="one-time-code"
                      className="font-mono uppercase tracking-[0.2em]"
                      disabled={unsavedChanges || isExecuting}
                      maxLength={12}
                      onInput={onChange}
                      placeholder="ABCD-EFGH"
                      spellCheck={false}
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div role="alert">
              {error && (
                <p className="mt-3 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink">
                  {error}
                </p>
              )}
            </div>
            <p className="mt-4 text-sm text-navy-blue/70">
              Sending freezes the recipient list and can't be undone.
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={isExecuting}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={unsavedChanges || isExecuting} type="submit">
                {isExecuting ? "Sending…" : "Send campaign"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
