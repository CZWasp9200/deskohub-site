import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Match, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import KeyRound from "lucide-react-native/icons/key-round";
import Mail from "lucide-react-native/icons/mail";
import Pencil from "lucide-react-native/icons/pencil";
import Trash2 from "lucide-react-native/icons/trash-2";
import { useReducer, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AddPasskeyAction } from "../../auth/passkey/add-passkey-action";
import { useReauthentication } from "../../auth/reauthentication";
import { reauthenticationNoticeMessage } from "../../auth/reauthentication-notice";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Badge } from "../../ui/badge";
import { BottomSheet } from "../../ui/bottom-sheet";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { BodyText, LiveMessage, TextField } from "../../ui/controls";
import { emailWithBreak } from "../../ui/email-with-break";
import { EmptyState } from "../../ui/empty-state";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { useToast } from "../../ui/toast";
import { space } from "../../ui/tokens";
import { useViewport } from "../../ui/viewport";
import { PasskeyListRow } from "./passkey-list-row";
import {
  deletePasskeyAtom,
  type PasskeyRow,
  passkeyNameMaximumLength,
  passkeyRow,
  passkeysAtom,
  passkeysReleased,
  passkeyWriteOutcome,
  renamePasskeyAtom,
} from "./passkeys";
import {
  initialSecurityScreenState,
  type PasskeyDialogFailure,
  reauthenticationPrompt,
  renameSubmission,
  renameValidation,
  type SecurityAnnouncement,
  SecurityScreenEvent,
  securityScreenReducer,
  shownPasskeyName,
} from "./security-screen-state";

// The provider over the creation date, each on its own line.
const passkeyDetails = (row: PasskeyRow, locale: AppLocale) => {
  const created = Option.getOrUndefined(
    Option.map(row.createdAt, (createdAt) =>
      m.security_passkey_created_on(
        { date: formatInstant(createdAt, locale, "date") },
        { locale }
      )
    )
  );
  const lines = [row.provider, created].filter((line) => line !== undefined);
  return lines.length === 0 ? undefined : lines.join("\n");
};

const passkeysErrorMessage =
  (locale: AppLocale) => (error: CustomerViewError) =>
    Match.value(error).pipe(
      Match.tags({
        Unavailable: () => m.security_passkeys_unavailable({}, { locale }),
        TimedOut: () => m.security_passkeys_unavailable({}, { locale }),
      }),
      Match.orElse(() => undefined)
    );

const announcementMessage = (
  announcement: SecurityAnnouncement | undefined,
  locale: AppLocale
) =>
  announcement === undefined
    ? undefined
    : {
        renamed: m.security_renamed,
        deleted: m.security_deleted,
        gone: m.security_passkey_gone,
      }[announcement]({}, { locale });

const dialogFailureMessage = ({
  failure,
  kind,
  reauthenticationRequired,
  locale,
}: {
  readonly failure: PasskeyDialogFailure | undefined;
  readonly kind: "rename" | "delete";
  readonly reauthenticationRequired: boolean;
  readonly locale: AppLocale;
}) =>
  failure === undefined
    ? undefined
    : {
        "reauthentication-required": () =>
          reauthenticationRequired
            ? m.security_reauthentication_required({}, { locale })
            : undefined,
        unconfirmed: () => m.account_save_unconfirmed({}, { locale }),
        failed: () =>
          ({
            rename: m.security_rename_failed,
            delete: m.security_delete_failed,
          })[kind]({}, { locale }),
      }[failure]();

/**
 * Sign-in & security: email sign-in, which always works, and the account's
 * passkeys (hidden while the release withholds them), which the customer can
 * add, rename and delete.
 */
export function SecurityScreen() {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const account = useAtomValue(accountAtom);
  const refreshAccount = useAtomRefresh(accountAtom);
  const passkeys = useAtomValue(passkeysAtom);
  const refreshPasskeys = useAtomRefresh(passkeysAtom);
  const renaming = useAtomValue(renamePasskeyAtom).waiting;
  const deleting = useAtomValue(deletePasskeyAtom).waiting;
  const rename = useAtomSet(renamePasskeyAtom, { mode: "promiseExit" });
  const remove = useAtomSet(deletePasskeyAtom, { mode: "promiseExit" });
  const { state: reauthenticationTask, reauthenticate } = useReauthentication();
  const [state, dispatch] = useReducer(
    securityScreenReducer,
    initialSecurityScreenState
  );
  const toast = useToast();
  // The passkey whose menu is open, with how many the list shows.
  const [menu, setMenu] = useState<{
    readonly row: PasskeyRow;
    readonly passkeyCount: number;
  }>();

  const prompt = reauthenticationPrompt(
    state.reauthentication,
    reauthenticationTask
  );
  const promptProgress =
    prompt.notice === undefined
      ? undefined
      : reauthenticationNoticeMessage(prompt.notice, locale);
  const dialog = state.dialog;
  const defaultName = m.security_passkey_default_name({}, { locale });
  const rows = Option.getOrUndefined(
    Option.map(AsyncResult.value(passkeys), (list) =>
      list.map((passkey) => passkeyRow(passkey, defaultName))
    )
  );

  const confirmItsYou = async () => {
    const outcome = await reauthenticate();
    dispatch(SecurityScreenEvent.ReauthenticationEnded({ outcome }));
  };

  const runWrite = async (
    write: () => Promise<Parameters<typeof passkeyWriteOutcome>[0]>
  ) => {
    dispatch(SecurityScreenEvent.WriteStarted());
    const outcome = passkeyWriteOutcome(await write());
    dispatch(SecurityScreenEvent.WriteEnded({ outcome }));
    if (outcome === "reauthentication-required") await confirmItsYou();
  };

  const saveName = () => {
    if (dialog === undefined) return;
    const shownName = shownPasskeyName(dialog, rows);
    const submission = renameSubmission(dialog, shownName);
    dispatch(SecurityScreenEvent.RenameSubmitted({ shownName }));
    if (submission._tag === "Save") {
      void runWrite(() => rename({ id: submission.id, name: submission.name }));
    }
  };

  const validation = renameValidation(dialog);
  const validationMessage =
    validation === undefined
      ? undefined
      : {
          Required: () => m.security_rename_required({}, { locale }),
          TooLong: () =>
            m.security_rename_maximum(
              { max: passkeyNameMaximumLength },
              { locale }
            ),
        }[validation._tag]();
  const dialogFailure =
    dialog === undefined
      ? undefined
      : dialogFailureMessage({
          failure: dialog.failure,
          kind: dialog.kind,
          reauthenticationRequired: prompt.required,
          locale,
        });

  const adding = (kind: "first" | "another") => (
    <AddPasskeyAction
      kind={kind}
      width={isWide && kind === "another" ? "content" : "full"}
      onStart={() => dispatch(SecurityScreenEvent.PasskeyAddStarted())}
      onSettled={() => dispatch(SecurityScreenEvent.PasskeyAddSettled())}
      onAdded={() => {
        dispatch(SecurityScreenEvent.PasskeyAdded());
        toast.show({
          message: m.security_passkey_created({}, { locale }),
          tone: "confirmation",
        });
        refreshPasskeys();
      }}
      onReauthenticationRequired={() => {
        dispatch(SecurityScreenEvent.AddReauthenticationRequired());
        void confirmItsYou();
      }}
    />
  );

  return (
    <ScrollScreen
      refreshing={passkeys.waiting && !AsyncResult.isInitial(passkeys)}
      onRefresh={refreshPasskeys}
    >
      <SectionHeader first title={m.security_methods_title({}, { locale })} />
      <AsyncView result={account} onRetry={refreshAccount}>
        {(current) => (
          <ListGroup>
            <ListRow
              icon={Mail}
              label={m.account_row_security_email_code({}, { locale })}
              description={m.security_email_body(
                { email: emailWithBreak(current.email) },
                { locale }
              )}
              badge={
                <Badge
                  tone="positive"
                  label={m.security_email_badge({}, { locale })}
                />
              }
            />
          </ListGroup>
        )}
      </AsyncView>
      {passkeysReleased(passkeys) && (
        <>
          <SectionHeader
            title={m.security_passkeys_title({}, { locale })}
            description={m.security_passkeys_intro({}, { locale })}
          />
          <AsyncView
            result={passkeys}
            onRetry={refreshPasskeys}
            errorMessage={passkeysErrorMessage(locale)}
          >
            {(list) => {
              const listed = list.map((passkey) =>
                passkeyRow(passkey, defaultName)
              );
              return listed.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  tone="action"
                  dashed
                  title={m.security_passkeys_empty_title({}, { locale })}
                >
                  {adding("first")}
                </EmptyState>
              ) : (
                <>
                  <ListGroup>
                    {listed.map((row) => (
                      <PasskeyListRow
                        key={row.id}
                        name={row.name}
                        details={passkeyDetails(row, locale)}
                        menuLabel={m.security_passkey_menu_label(
                          { name: row.name },
                          { locale }
                        )}
                        disabled={state.adding}
                        onOpenMenu={() =>
                          setMenu({ row, passkeyCount: listed.length })
                        }
                      />
                    ))}
                  </ListGroup>
                  <View style={isWide ? styles.anotherWide : styles.another}>
                    {adding("another")}
                  </View>
                </>
              );
            }}
          </AsyncView>
        </>
      )}
      <BottomSheet
        visible={menu !== undefined}
        title={menu?.row.name}
        onDismiss={() => setMenu(undefined)}
      >
        <ListGroup>
          <ListRow
            kind="action"
            icon={Pencil}
            label={m.security_passkey_rename({}, { locale })}
            accessibilityLabel={
              menu === undefined
                ? undefined
                : m.security_passkey_rename_label(
                    { name: menu.row.name },
                    { locale }
                  )
            }
            onPress={() => {
              if (menu === undefined) return;
              setMenu(undefined);
              dispatch(SecurityScreenEvent.RenameOpened({ passkey: menu.row }));
            }}
          />
          <ListRow
            kind="action"
            destructive
            icon={Trash2}
            label={m.security_passkey_delete({}, { locale })}
            accessibilityLabel={
              menu === undefined
                ? undefined
                : m.security_passkey_delete_label(
                    { name: menu.row.name },
                    { locale }
                  )
            }
            onPress={() => {
              if (menu === undefined) return;
              setMenu(undefined);
              dispatch(
                SecurityScreenEvent.DeleteOpened({
                  passkey: menu.row,
                  passkeyCount: menu.passkeyCount,
                })
              );
            }}
          />
        </ListGroup>
      </BottomSheet>
      {/* Kept mounted so assistive tech announces each change; an open
          dialog speaks for itself. */}
      <LiveMessage
        role="status"
        message={announcementMessage(state.announcement, locale)}
      />
      <LiveMessage
        role="alert"
        message={
          dialog === undefined && prompt.required
            ? m.security_reauthentication_required({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="status"
        message={dialog === undefined ? promptProgress : undefined}
      />
      <ConfirmDialog
        visible={dialog?.kind === "rename"}
        title={m.security_rename_title({}, { locale })}
        body={m.security_rename_body({}, { locale })}
        confirmLabel={m.security_rename_save({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        onConfirm={saveName}
        onCancel={() => dispatch(SecurityScreenEvent.DialogCancelled())}
        busy={renaming}
        busyMessage={m.security_rename_saving({}, { locale })}
      >
        <TextField
          label={m.security_rename_name_label({}, { locale })}
          value={dialog?.kind === "rename" ? dialog.draft : ""}
          onChangeText={(draft) =>
            dispatch(SecurityScreenEvent.DraftChanged({ draft }))
          }
          onSubmitEditing={saveName}
          editable={!renaming}
          autoFocus
        />
        <LiveMessage
          role="alert"
          message={
            dialog?.kind === "rename"
              ? (validationMessage ?? dialogFailure)
              : undefined
          }
        />
        <LiveMessage
          role="status"
          message={dialog?.kind === "rename" ? promptProgress : undefined}
        />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog?.kind === "delete"}
        title={m.security_delete_title(
          { name: dialog?.passkey.name ?? "" },
          { locale }
        )}
        body={m.security_delete_body({}, { locale })}
        confirmLabel={m.security_delete_confirm({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          const id = dialog.passkey.id;
          void runWrite(() => remove(id));
        }}
        onCancel={() => dispatch(SecurityScreenEvent.DialogCancelled())}
        destructive
        busy={deleting}
        busyMessage={m.security_deleting({}, { locale })}
      >
        {dialog?.kind === "delete" && dialog.last && (
          <BodyText>{m.security_delete_last_body({}, { locale })}</BodyText>
        )}
        <LiveMessage
          role="alert"
          message={dialog?.kind === "delete" ? dialogFailure : undefined}
        />
        <LiveMessage
          role="status"
          message={dialog?.kind === "delete" ? promptProgress : undefined}
        />
      </ConfirmDialog>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  another: { marginTop: space.lg },
  anotherWide: { marginTop: space.md },
});
