import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext, useId } from "react";
import type { UpdatePrompt } from "./update-prompt";

/** The one update offer the app shows, and what pressing its buttons does. */
export interface UpdateOffer {
  readonly prompt: UpdatePrompt | undefined;
  readonly accept: () => void;
  readonly dismiss: () => void;
  /** Whether a focused screen shows the offer in its own content. */
  readonly hostedByScreen: boolean;
}

/** The shared offer and the screens hosting it, as the provider keeps them. */
export interface UpdateOfferState extends UpdateOffer {
  /** Starts (`true`) or ends (`false`) the screen `key` hosting the offer. */
  readonly host: (key: string, hosting: boolean) => void;
}

/**
 * Set by `UpdateOfferProvider` (`update-offer-provider.tsx`, which runs the
 * update checks). Outside it, as in a screen's own tests or a gallery, there
 * is no offer and hosting changes nothing.
 */
export const UpdateOfferContext = createContext<UpdateOfferState>({
  prompt: undefined,
  accept: () => undefined,
  dismiss: () => undefined,
  hostedByScreen: false,
  host: () => undefined,
});

const useUpdateOfferState = (): UpdateOfferState =>
  useContext(UpdateOfferContext);

/** The update offer to show, or `undefined` while there is none. */
export const useUpdateOffer = (): UpdateOffer => {
  const { prompt, accept, dismiss, hostedByScreen } = useUpdateOfferState();
  return { prompt, accept, dismiss, hostedByScreen };
};

/**
 * Marks the focused screen as the place for the update offer, so the bottom
 * banner stays away while it is focused: a critical flow that shows the
 * quiet card in its content, or a transient screen that shows no offer at
 * all. The mark ends when the screen loses focus or unmounts.
 */
export const useUpdateOfferHost = () => {
  const key = useId();
  const { host } = useUpdateOfferState();
  useFocusEffect(
    useCallback(() => {
      host(key, true);
      return () => host(key, false);
    }, [key, host])
  );
};
