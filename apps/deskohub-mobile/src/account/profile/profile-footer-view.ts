import { Match } from "effect";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { CompletionTextField } from "./profile-draft";
import type { ProfileSubmitState } from "./profile-save";

/**
 * What a profile form's sticky footer says above its Save button, as data:
 * the screen words it. One message per problem: a field's own error sits at
 * the field and the footer only counts the fields to fix here.
 */
export type ProfileFooterMessage =
  /** Nothing to save; the button rests disabled and says why. */
  | { readonly kind: "no-changes" }
  /** Fields on this screen to fix before saving. */
  | { readonly kind: "fix-fields"; readonly count: number }
  /** The fields to fix are on another screen sharing the draft. */
  | { readonly kind: "fix-elsewhere" }
  /** The save request failed. */
  | { readonly kind: "failed"; readonly error: CustomerViewError };

export interface ProfileFooterView {
  readonly message: ProfileFooterMessage | undefined;
  readonly saveEnabled: boolean;
  readonly saving: boolean;
}

/**
 * The footer of a profile form for its submit state, whether the draft
 * differs from the saved profile, and which fields the form shows.
 */
export const profileFooterView = (
  state: ProfileSubmitState,
  unsaved: boolean,
  shownFields: ReadonlyArray<CompletionTextField>
): ProfileFooterView => {
  const saving = state._tag === "Submitting";
  const message = Match.value(state).pipe(
    Match.tagsExhaustive({
      Idle: () => undefined,
      Submitting: () => undefined,
      Done: () => undefined,
      Invalid: ({ invalid }): ProfileFooterMessage => {
        const count = shownFields.filter(
          (field) => invalid.fields[field] !== undefined
        ).length;
        return count > 0
          ? { kind: "fix-fields", count }
          : { kind: "fix-elsewhere" };
      },
      Failed: ({ error }): ProfileFooterMessage => ({ kind: "failed", error }),
    })
  );
  return {
    message:
      message ?? (!saving && !unsaved ? { kind: "no-changes" } : undefined),
    saveEnabled: unsaved && !saving,
    saving,
  };
};
