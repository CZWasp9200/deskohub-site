import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Effect, Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import Check from "lucide-react-native/icons/check";
import KeyRound from "lucide-react-native/icons/key-round";
import LogOut from "lucide-react-native/icons/log-out";
import Mail from "lucide-react-native/icons/mail";
import Receipt from "lucide-react-native/icons/receipt";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Trash2 from "lucide-react-native/icons/trash-2";
import { useEffect, useReducer, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { apiOrigin } from "../../auth/auth-client";
import { useReauthentication } from "../../auth/reauthentication";
import { nativeSignInFailureMessage } from "../../auth/sign-in-failure-message";
import { signOut } from "../../auth/sign-out";
import { standaloneTaskRuntime } from "../../auth/use-auth-task";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { openSitePage } from "../../routing/open-site-page";
import { contactPageUrl } from "../../routing/site-page";
import { ActionFooter } from "../../ui/action-footer";
import { Badge } from "../../ui/badge";
import { Card } from "../../ui/card";
import { CheckboxRow } from "../../ui/checkbox";
import { Button, LiveMessage } from "../../ui/controls";
import { Dialog } from "../../ui/dialog";
import { discColors, EmptyState } from "../../ui/empty-state";
import { Icon, type IconComponent } from "../../ui/icon";
import { ListGroup } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";
import {
  type DeleteScreenView,
  type DeletionAttempt,
  type DeletionDialog,
  type DeletionFlow,
  deleteScreenView,
  deletionAttemptOf,
  deletionDialogBusy,
  deletionFlowAfter,
  deletionSubmittable,
  offersContact,
  requestAccountDeletionAtom,
  startingDeletionFlow,
} from "./account-deletion";
import { deletedAccountExit } from "./deleted-account-exit";

// The global router: these screens unmount as the replace takes the
// signed-in routes away, and the exit outlives them.
const leaveDeletedAccountScreens = deletedAccountExit.leave({
  leave: Effect.sync(() => router.replace("/account-deleted")),
  signOut,
});

// Where no browser is available there is nothing else to open.
const openContactPage = () =>
  void openSitePage(contactPageUrl(apiOrigin)).catch(() => undefined);

/** The sentence for an outcome the screen shows above its content. */
const screenNotice = (
  attempt: DeletionAttempt | undefined,
  locale: AppLocale
) =>
  attempt?.kind === "unconfirmed"
    ? m.danger_unconfirmed({}, { locale })
    : undefined;

/** Why the last request never got the server's answer, said in the dialog. */
const requestFailureMessage = (
  attempt: DeletionAttempt | undefined,
  locale: AppLocale
) =>
  attempt?.kind === "request-failed"
    ? (sharedViewErrorMessage(attempt.error, locale) ??
      m.danger_request_failed({}, { locale }))
    : undefined;

/**
 * Deleting the account (or retrying a pending deletion): what happens, the
 * customer's confirmation and a last check. A sign-in the server finds too
 * old asks the customer to confirm it's them, then returns to the last
 * check. A deleted account leaves for the deleted-account screen and signs
 * out; the account stays usable until then.
 */
export function DangerZoneScreen() {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const requestDeletion = useAtomSet(requestAccountDeletionAtom, {
    mode: "promiseExit",
  });
  const reauthentication = useReauthentication("delete-account");
  const [flow, dispatch] = useReducer(deletionFlowAfter, startingDeletionFlow);
  // Held from a press until its answer, so a second press before the next
  // render sends nothing.
  const pressed = useRef(false);

  // A web sign-in that confirmed it's them returned here: continue at the
  // last check once the account has been read.
  const { takeConfirmedReturn } = reauthentication;
  const [resuming, setResuming] = useState(false);
  useEffect(() => {
    if (takeConfirmedReturn()) setResuming(true);
  }, [takeConfirmedReturn]);
  const settled = AsyncResult.isSuccess(account) && !account.waiting;
  if (resuming && settled) {
    setResuming(false);
    dispatch({ type: "resumed" });
  }

  const submittable = deletionSubmittable(account, flow);
  const open = flow.dialog.step !== "closed";
  // The account no longer offers deletion (or couldn't be read) under the
  // open dialog: close it, and the screen shows what the account offers now.
  if (open && !deletionDialogBusy(flow.dialog) && settled && !submittable) {
    dispatch({ type: "withdrawn" });
  }

  const deleteNow = async () => {
    if (pressed.current || !submittable || flow.dialog.step !== "confirm") {
      return;
    }
    pressed.current = true;
    dispatch({ type: "delete" });
    const attempt = deletionAttemptOf(await requestDeletion(undefined));
    dispatch({ type: "answered", attempt });
    if (attempt.kind === "deleted") {
      // Outside the account's registry, which ends with these screens. The
      // press guard stays held: the account is gone.
      standaloneTaskRuntime.runFork(leaveDeletedAccountScreens);
      return;
    }
    pressed.current = false;
  };

  const signIn = async () => {
    if (pressed.current || flow.dialog.step !== "reauthenticate") return;
    pressed.current = true;
    dispatch({ type: "sign-in" });
    const outcome = await reauthentication.reauthenticate();
    dispatch({ type: "signed-in", outcome });
    pressed.current = false;
  };

  const notice = screenNotice(flow.attempt, locale);
  return (
    <View style={styles.screen}>
      <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
        {/* Kept mounted so assistive tech announces each change. */}
        <Notice tone="warning" message={notice} />
        <AsyncView result={account} onRetry={refresh}>
          {(current) => (
            <DeleteScreenContent
              view={deleteScreenView(current, flow)}
              confirmed={flow.confirmed}
              locale={locale}
              onConfirmedChange={(confirmed) =>
                dispatch({ type: "confirmation", confirmed })
              }
            />
          )}
        </AsyncView>
      </ScrollScreen>
      {AsyncResult.isSuccess(account) && (
        <DeleteScreenFooter
          view={deleteScreenView(account.value, flow)}
          locale={locale}
          onDelete={() => dispatch({ type: "open" })}
        />
      )}
      <DeletionDialogView
        flow={flow}
        refetching={open && account.waiting}
        sentence={{
          requestFailure: requestFailureMessage(flow.attempt, locale),
          signInFailure:
            reauthentication.state.status === "failed"
              ? reauthentication.state.failure
              : undefined,
        }}
        locale={locale}
        onDelete={() => void deleteNow()}
        onSignIn={() => void signIn()}
        onKeep={() => dispatch({ type: "keep" })}
      />
    </View>
  );
}

/** A statement of what deleting does: a small icon tile and plain text. */
function FactRow({
  icon,
  text,
}: {
  readonly icon: IconComponent;
  readonly text: string;
}) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIconBox}>
        <View style={styles.factIcon}>
          <Icon icon={icon} size={18} color={color.navy} />
        </View>
      </View>
      <Text variant="lead" style={styles.factText}>
        {text}
      </Text>
    </View>
  );
}

function DangerDisc() {
  return (
    <View
      style={[styles.disc, { backgroundColor: discColors.danger.background }]}
    >
      <Icon icon={Trash2} size={24} color={discColors.danger.ink} />
    </View>
  );
}

function DeleteScreenContent({
  view,
  confirmed,
  locale,
  onConfirmedChange,
}: {
  readonly view: DeleteScreenView;
  readonly confirmed: boolean;
  readonly locale: AppLocale;
  readonly onConfirmedChange: (confirmed: boolean) => void;
}) {
  const confirmation = (
    <CheckboxRow
      tone="danger"
      label={m.danger_confirm_label({}, { locale })}
      checked={confirmed}
      onChange={onConfirmedChange}
    />
  );
  return Match.value(view).pipe(
    Match.discriminatorsExhaustive("kind")({
      withheld: () => (
        <ContactCard
          title={m.danger_withheld({}, { locale })}
          locale={locale}
        />
      ),
      refused: () => (
        <ContactCard title={m.danger_refused({}, { locale })} locale={locale} />
      ),
      failed: () => (
        <View style={styles.content}>
          <Notice tone="error" message={m.danger_failed({}, { locale })} />
          {confirmation}
        </View>
      ),
      pending: () => (
        <View style={styles.content}>
          <View style={styles.head}>
            <DangerDisc />
            <Text variant="titleLarge" role="heading">
              {m.danger_pending_heading({}, { locale })}
            </Text>
            <Text variant="body" tone="muted">
              {m.danger_pending_description({}, { locale })}
            </Text>
          </View>
          {confirmation}
        </View>
      ),
      consequences: () => (
        <View style={styles.content}>
          <View style={styles.head}>
            <DangerDisc />
            <Text variant="titleLarge" role="heading">
              {m.danger_title({}, { locale })}
            </Text>
            <Text variant="body" tone="muted">
              {m.danger_consequences_lead({}, { locale })}
            </Text>
          </View>
          <ListGroup>
            <FactRow
              icon={LogOut}
              text={m.danger_consequence_sessions({}, { locale })}
            />
            <FactRow
              icon={Receipt}
              text={m.danger_consequence_records({}, { locale })}
            />
            <FactRow
              icon={KeyRound}
              text={m.danger_consequence_access({}, { locale })}
            />
          </ListGroup>
          {confirmation}
        </View>
      ),
    })
  );
}

/** The screen that offers no deletion here: Contact us is the way forward. */
function ContactCard({
  title,
  locale,
}: {
  readonly title: string;
  readonly locale: AppLocale;
}) {
  return (
    <Card>
      <EmptyState icon={Trash2} title={title}>
        <Button
          variant="quiet"
          icon={Mail}
          label={m.account_contact_us({}, { locale })}
          onPress={openContactPage}
        />
      </EmptyState>
    </Card>
  );
}

function DeleteScreenFooter({
  view,
  locale,
  onDelete,
}: {
  readonly view: DeleteScreenView;
  readonly locale: AppLocale;
  readonly onDelete: () => void;
}) {
  if (!("deleteAction" in view)) return null;
  return (
    <ActionFooter>
      <Button
        variant="danger"
        label={
          view.kind === "consequences"
            ? m.danger_button({}, { locale })
            : m.danger_retry_button({}, { locale })
        }
        disabled={view.deleteAction !== "enabled"}
        onPress={onDelete}
      />
      {offersContact(view) && (
        <Button
          variant="quiet"
          icon={Mail}
          label={m.account_contact_us({}, { locale })}
          onPress={openContactPage}
        />
      )}
    </ActionFooter>
  );
}

/**
 * The last check, and the request to confirm it's them when the server asks
 * for it. Each puts its action on top and the way out right under it.
 */
function DeletionDialogView({
  flow,
  refetching,
  sentence,
  locale,
  onDelete,
  onSignIn,
  onKeep,
}: {
  readonly flow: DeletionFlow;
  /** The last attempt's account refetch, which decides the next send. */
  readonly refetching: boolean;
  readonly sentence: {
    readonly requestFailure: string | undefined;
    readonly signInFailure:
      | Parameters<typeof nativeSignInFailureMessage>[0]
      | undefined;
  };
  readonly locale: AppLocale;
  readonly onDelete: () => void;
  readonly onSignIn: () => void;
  readonly onKeep: () => void;
}) {
  const { dialog } = flow;
  const busy = deletionDialogBusy(dialog);
  const dismiss = () => {
    if (!busy) onKeep();
  };
  const keep = (label: string) => (
    <Button
      key="keep"
      variant="secondary"
      label={label}
      onPress={onKeep}
      disabled={busy}
    />
  );
  if (isSignInStep(dialog)) {
    const failure =
      dialog.step === "reauthenticate" && dialog.after === "sign-in"
        ? sentence.signInFailure
        : undefined;
    const cancelled = failure?._tag === "SignInCancelled";
    const again =
      dialog.step === "reauthenticate" && dialog.after === "sign-in";
    return (
      <Dialog
        visible
        role="alertdialog"
        titleIcon={ShieldCheck}
        title={m.signin_reauthenticate_title({}, { locale })}
        body={m.signin_reauthenticate_delete_account_body({}, { locale })}
        busy={busy}
        onDismiss={dismiss}
        actions={[
          <Button
            key="sign-in"
            label={
              again
                ? m.account_retry({}, { locale })
                : m.danger_reauth_continue({}, { locale })
            }
            onPress={onSignIn}
            busy={dialog.step === "reauthenticating"}
          />,
          keep(
            again
              ? m.danger_keep({}, { locale })
              : m.account_cancel({}, { locale })
          ),
          <LiveMessage
            key="progress"
            role="status"
            message={
              dialog.step === "reauthenticating"
                ? m.reauthentication_in_progress({}, { locale })
                : undefined
            }
          />,
        ]}
      >
        <Notice
          tone="info"
          message={
            cancelled ? m.danger_reauth_cancelled({}, { locale }) : undefined
          }
        />
        <LiveMessage
          role="alert"
          message={
            failure !== undefined && !cancelled
              ? nativeSignInFailureMessage(failure, locale)
              : undefined
          }
        />
      </Dialog>
    );
  }
  const signedInAgain =
    (dialog.step === "confirm" || dialog.step === "deleting") &&
    dialog.signedInAgain;
  return (
    <Dialog
      visible={dialog.step !== "closed"}
      role="alertdialog"
      header={
        signedInAgain ? (
          <View style={styles.badge}>
            <Badge
              tone="positive"
              icon={Check}
              label={m.danger_signed_in_again({}, { locale })}
            />
          </View>
        ) : undefined
      }
      title={m.danger_confirm_title({}, { locale })}
      body={m.danger_confirm_body({}, { locale })}
      busy={busy || refetching}
      onDismiss={dismiss}
      actions={[
        <Button
          key="delete"
          variant="danger"
          label={m.danger_confirm({}, { locale })}
          onPress={onDelete}
          busy={busy || refetching}
        />,
        keep(m.danger_keep({}, { locale })),
        <LiveMessage
          key="progress"
          role="status"
          message={
            dialog.step === "leaving"
              ? m.danger_signing_out({}, { locale })
              : undefined
          }
        />,
      ]}
    >
      <LiveMessage
        role="alert"
        message={
          dialog.step === "confirm" ? sentence.requestFailure : undefined
        }
      />
    </Dialog>
  );
}

const isSignInStep = (dialog: DeletionDialog) =>
  dialog.step === "reauthenticate" || dialog.step === "reauthenticating";

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  content: { gap: space.lg },
  head: { gap: space.sm, paddingTop: space.sm },
  disc: {
    alignItems: "center",
    borderRadius: radius.disc,
    height: 56,
    justifyContent: "center",
    marginBottom: space.sm,
    width: 56,
  },
  badge: { flexDirection: "row" },
  fact: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  // The 32 tile centred where a list row's 40 tile sits, so the text starts
  // where the group's dividers do.
  factIconBox: { alignItems: "center", width: 40 },
  factIcon: {
    alignItems: "center",
    backgroundColor: color.sunken,
    borderRadius: 10,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  factText: { color: color.navy, flexShrink: 1, paddingTop: 5 },
});
