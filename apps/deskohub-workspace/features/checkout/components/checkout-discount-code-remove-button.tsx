"use client";

import { useFormStatus } from "react-dom";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/** Submits the form that removes the entered discount code. */
export function CheckoutDiscountCodeRemoveButton({
  locale,
}: {
  readonly locale: Locale;
}) {
  const { pending } = useFormStatus();
  return (
    <Button pending={pending} size="xs" type="submit" variant="link">
      {m.checkoutDiscountCodeRemove({}, { locale })}
    </Button>
  );
}
