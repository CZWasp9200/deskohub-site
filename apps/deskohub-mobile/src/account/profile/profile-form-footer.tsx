import { Match } from "effect";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ActionFooter } from "../../ui/action-footer";
import { Button } from "../../ui/controls";
import type { ContentWidth } from "../../ui/viewport";
import type { CompletionTextField } from "./profile-draft";
import {
  type ProfileFooterMessage,
  profileFooterView,
} from "./profile-footer-view";
import type { ProfileSubmitState } from "./profile-save";

/** The other screen editing the same draft, where fields may need fixing. */
export interface ProfileFormElsewhere {
  /** Says the fields to fix are on that screen. */
  readonly message: string;
  /** Names the screen on the button that opens it. */
  readonly label: string;
  readonly onPress: () => void;
}

const footerMessage = (
  message: ProfileFooterMessage | undefined,
  elsewhere: ProfileFormElsewhere,
  locale: AppLocale
): string | undefined =>
  message === undefined
    ? undefined
    : Match.value(message).pipe(
        Match.discriminatorsExhaustive("kind")({
          "no-changes": () => m.profile_no_changes({}, { locale }),
          "fix-fields": ({ count }) =>
            count === 1
              ? m.profile_fix_one_field({}, { locale })
              : m.profile_fix_fields({ count }, { locale }),
          "fix-elsewhere": () => elsewhere.message,
          failed: ({ error }) =>
            error._tag === "LinkRequired"
              ? m.profile_link_required({}, { locale })
              : (sharedViewErrorMessage(error, locale) ??
                m.profile_save_failed({}, { locale })),
        })
      );

/**
 * The sticky footer of a screen editing the profile draft: Save, with one
 * line above it on why it rests or what to fix (`profileFooterView` for
 * `shownFields`), and a button to the other screen when the fields to fix
 * are there. It stays above the keyboard with the screen's keyboard view.
 */
export function ProfileFormFooter({
  state,
  unsaved,
  shownFields,
  onSave,
  elsewhere,
  locale,
  layout = "stacked",
  contentWidth = "form",
}: {
  readonly state: ProfileSubmitState;
  readonly unsaved: boolean;
  readonly shownFields: ReadonlyArray<CompletionTextField>;
  readonly onSave: () => void;
  readonly elsewhere: ProfileFormElsewhere;
  readonly locale: AppLocale;
  readonly layout?: "inline" | "stacked";
  readonly contentWidth?: ContentWidth;
}) {
  const footer = profileFooterView(state, unsaved, shownFields);
  return (
    <ActionFooter
      contentWidth={layout === "inline" ? contentWidth : undefined}
      message={footerMessage(footer.message, elsewhere, locale)}
      messageTone={
        footer.message === undefined || footer.message.kind === "no-changes"
          ? "neutral"
          : "error"
      }
    >
      <Button
        label={m.profile_save({}, { locale })}
        onPress={onSave}
        disabled={!footer.saveEnabled}
        busy={footer.saving}
        width={layout === "inline" ? "content" : "full"}
      />
      {footer.message?.kind === "fix-elsewhere" && (
        <Button
          variant="secondary"
          label={elsewhere.label}
          onPress={elsewhere.onPress}
          width={layout === "inline" ? "content" : "full"}
        />
      )}
    </ActionFooter>
  );
}
