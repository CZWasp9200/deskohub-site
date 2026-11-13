"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { updateDisplayName } from "@/features/account/actions/profile";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export function ProfileForm({
  name: savedName,
  email,
}: {
  readonly name: string;
  readonly email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(savedName);
  const trimmedName = name.trim();
  const invalid = trimmedName.length < 2 || trimmedName.length > 40;

  const { execute, isExecuting } = useAction(updateDisplayName, {
    onSuccess: ({ data }) => {
      if (!data?.saved) {
        toast.error(m["account.profile.saveFailed"]());
        return;
      }
      toast.success(m["account.profile.saved"]());
      router.refresh();
    },
    onError: () => {
      toast.error(m["account.profile.saveFailed"]());
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!invalid) execute({ name: trimmedName });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="account-name" className="text-gray-200">
          {m["account.profile.nameLabel"]()}
        </Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="account-name"
            name="name"
            autoComplete="nickname"
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            variant={invalid ? "error" : "default"}
            aria-describedby="account-name-hint"
            className="border-gray-600 bg-gray-900 text-white"
          />
          <Button
            type="submit"
            disabled={isExecuting || invalid || trimmedName === savedName}
            className="bg-green-500 font-semibold text-gray-900 hover:bg-green-400"
          >
            {isExecuting
              ? m["account.profile.saving"]()
              : m["account.profile.save"]()}
          </Button>
        </div>
        <p id="account-name-hint" className="mt-2 text-sm text-gray-400">
          {invalid
            ? m["account.profile.nameInvalid"]()
            : m["account.profile.nameHint"]()}
        </p>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-200">
          {m["account.profile.emailLabel"]()}
        </p>
        <p className="mt-1 break-all text-gray-300">{email}</p>
      </div>
    </form>
  );
}
