import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { Match, Option, Result } from "effect";
import {
  type CompletionDraft,
  type CompletionTextField,
  identityFields,
  type ProfileDraftInvalid,
  validateCompletionDraft,
} from "../profile/profile-draft";
import type { ProfileSubmitState } from "../profile/profile-save";

/** The two steps of completing a profile, in order. */
export type OnboardingStep = "about-you" | "billing";

export const onboardingSteps: ReadonlyArray<OnboardingStep> = [
  "about-you",
  "billing",
];

/** About you's fields: name and phone, then the referral code when offered. */
export const aboutYouFields = (
  referralsEnabled: boolean
): ReadonlyArray<CompletionTextField> => [
  ...identityFields,
  ...(referralsEnabled ? (["referralCode"] as const) : []),
];

/** The step that shows `field`. */
export const stepOfField = (field: CompletionTextField): OnboardingStep =>
  field === "referralCode" ||
  (identityFields as ReadonlyArray<string>).includes(field)
    ? "about-you"
    : "billing";

/** The step holding the first field a refused submit names, if any. */
export const stepOfInvalid = (
  invalid: ProfileDraftInvalid<CompletionTextField>
): Option.Option<OnboardingStep> => Option.map(invalid.first, stepOfField);

/** `invalid` narrowed to `fields`, keeping their order for the first one. */
const invalidAmong = (
  invalid: ProfileDraftInvalid<CompletionTextField>,
  fields: ReadonlyArray<CompletionTextField>
): Option.Option<ProfileDraftInvalid<CompletionTextField>> => {
  const shown = fields.filter((field) => invalid.fields[field] !== undefined);
  return shown.length === 0
    ? Option.none()
    : Option.some({
        fields: Object.fromEntries(
          shown.map((field) => [field, invalid.fields[field]])
        ),
        first: Option.fromNullishOr(shown[0]),
      });
};

/**
 * What About you's Continue finds before the billing step: the problems
 * of its own fields under the contract's schema, the same check the final
 * submit runs, so a field is pointed at before the customer moves on.
 * Nothing is sent; the Workspace still decides at the submit.
 */
export const aboutYouRefusal = ({
  draft,
  invitationCode,
  phoneRegion,
  referralsEnabled,
}: {
  readonly draft: CompletionDraft;
  readonly invitationCode: string | undefined;
  readonly phoneRegion: string;
  readonly referralsEnabled: boolean;
}): Option.Option<ProfileDraftInvalid<CompletionTextField>> =>
  Result.match(validateCompletionDraft(draft, invitationCode, phoneRegion), {
    onSuccess: () => Option.none(),
    onFailure: (invalid) =>
      invalidAmong(invalid, aboutYouFields(referralsEnabled)),
  });

/**
 * Whether the completion this flow submitted made the account linked: it
 * succeeded, is still reading the account again, or couldn't be confirmed
 * although the account read again shows it applied.
 */
export const createdHere = (completion: ProfileSubmitState) =>
  Match.value(completion).pipe(
    Match.tagsExhaustive({
      Idle: () => false,
      Submitting: () => true,
      Done: () => true,
      Invalid: () => false,
      Failed: ({ error }) => error._tag === "Unconfirmed",
    })
  );

/**
 * What an onboarding step shows for the account: its form while the
 * account needs a profile, the finish once this flow created it, and
 * otherwise nothing, leaving for the tab it opened over.
 */
export type OnboardingView = "form" | "finish" | "leave";

export const onboardingView = (
  account: CustomerAccountState,
  completion: ProfileSubmitState
): OnboardingView => {
  if (account.kind === "completion-required") return "form";
  return account.kind === "linked" && createdHere(completion)
    ? "finish"
    : "leave";
};
