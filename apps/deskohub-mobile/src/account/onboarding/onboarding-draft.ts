import {
  accountPhoneRegion,
  type CustomerAccountState,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/reactivity";
import { useDeviceCountry } from "../../i18n/device-locale";
import type {
  CompletionDraft,
  CompletionTextField,
} from "../profile/profile-draft";
import {
  completeProfileAtom,
  completionEditsAtom,
  currentCompletionDraft,
  invitationCodeOf,
  profileSubmitState,
} from "../profile/profile-save";

/** An account that has a verified email but no customer profile yet. */
export type CompletionRequiredAccount = Extract<
  CustomerAccountState,
  { kind: "completion-required" }
>;

/**
 * The completion draft both onboarding steps edit, and its one submit
 * (POST /account/profile through `completeProfileAtom`). The draft lives in
 * `completionEditsAtom`, so it outlasts the steps: moving between them,
 * closing onboarding and opening it again keep what was typed.
 */
export function useOnboardingDraft(account: CompletionRequiredAccount) {
  const invitationCode = invitationCodeOf(account);
  const phoneRegion = accountPhoneRegion(account.locale);
  const deviceCountry = useDeviceCountry();
  const [edits, setEdits] = useAtom(completionEditsAtom);
  const result = useAtomValue(completeProfileAtom);
  const complete = useAtomSet(completeProfileAtom);
  const draft = currentCompletionDraft(edits, invitationCode, deviceCountry);
  // The last submit's message and field problems no longer describe it.
  const resetSubmit = () => {
    if (!result.waiting) complete(Atom.Reset);
  };
  const change = (change: Partial<CompletionDraft>) => {
    setEdits(Option.some({ ...draft, ...change }));
    resetSubmit();
  };
  return {
    draft,
    invitationCode,
    phoneRegion,
    state: profileSubmitState(result),
    /** Changes several fields at once, as an applied company lookup does. */
    change,
    setField: (field: CompletionTextField, value: string) =>
      change({ [field]: value }),
    resetSubmit,
    submit: () => complete({ draft, invitationCode, phoneRegion }),
  };
}
