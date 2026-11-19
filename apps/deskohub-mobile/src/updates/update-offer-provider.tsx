import { type ReactNode, useCallback, useState } from "react";
import { UpdateOfferContext } from "./update-offer";
import { useUpdatePrompt } from "./use-update-prompt";

/**
 * Checks for updates once for the whole app and shares the one offer, so the
 * bottom banner and a screen's own update card show, accept and dismiss the
 * same prompt. Mounted once at the root.
 */
export function UpdateOfferProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { prompt, accept, dismiss } = useUpdatePrompt();
  const [hosts, setHosts] = useState<ReadonlySet<string>>(() => new Set());
  const host = useCallback(
    (key: string, hosting: boolean) =>
      setHosts((current) => {
        if (current.has(key) === hosting) return current;
        const next = new Set(current);
        if (hosting) next.add(key);
        else next.delete(key);
        return next;
      }),
    []
  );
  return (
    <UpdateOfferContext
      value={{ prompt, accept, dismiss, hostedByScreen: hosts.size > 0, host }}
    >
      {children}
    </UpdateOfferContext>
  );
}
