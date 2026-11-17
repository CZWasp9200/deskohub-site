import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import Bot from "lucide-react-native/icons/bot";
import ExternalLink from "lucide-react-native/icons/external-link";
import { useState } from "react";
import { apiOrigin } from "../../auth/auth-client";
import { AsyncView } from "../../customer-api/async-view";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { openSitePage } from "../../routing/open-site-page";
import { sitePageUrl } from "../../routing/site-page";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { Button, LiveMessage } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { ListGroup } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { AssistantConnectionRow } from "./assistant-connection-row";
import {
  assistantConnectionsAtom,
  assistantRows,
  type DisconnectTarget,
  disconnectAssistantAtom,
  disconnectedAssistantsAtom,
  disconnectView,
  isAssistantsUnavailable,
} from "./connected-assistants";

// The list couldn't be read: the screen says so in its own words.
const listErrorMessage = (locale: AppLocale) => (error: CustomerViewError) =>
  isAssistantsUnavailable(error)
    ? m.assistants_unavailable({}, { locale })
    : undefined;

/**
 * Connected assistants: the AI assistants the customer let use their
 * account, what each may do, and a way to disconnect one. It needs only the
 * session, so it works without a linked Dotypos profile. The disconnect
 * dialog states what disconnecting does, so the screen has no intro line.
 */
export function AssistantsScreen() {
  const locale = useAppLocale();
  const connections = useAtomValue(assistantConnectionsAtom);
  const refresh = useAtomRefresh(assistantConnectionsAtom);
  const disconnected = useAtomValue(disconnectedAssistantsAtom);
  const [result, disconnect] = useAtom(disconnectAssistantAtom);
  const [target, setTarget] = useState<DisconnectTarget>();
  const [helpFailed, setHelpFailed] = useState(false);

  // The site's help page with the steps for each assistant.
  const openConnectingHelp = () => {
    setHelpFailed(false);
    openSitePage(sitePageUrl("/ai-assistants", apiOrigin)).catch(() =>
      setHelpFailed(true)
    );
  };

  const view = disconnectView({ target, result });
  const targetName = target?.name ?? m.assistants_unnamed({}, { locale });

  const ask = (next: DisconnectTarget) => {
    // A new confirmation starts without the last attempt's outcome.
    disconnect(Atom.Reset);
    setTarget(next);
  };

  return (
    <ScrollScreen
      refreshing={connections.waiting && !AsyncResult.isInitial(connections)}
      onRefresh={refresh}
    >
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="status"
        message={
          view.outcome === "disconnected"
            ? m.assistants_disconnected({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          helpFailed ? m.assistants_help_open_failed({}, { locale }) : undefined
        }
      />
      <Notice
        tone="error"
        message={
          view.outcome === "unconfirmed"
            ? m.account_save_unconfirmed({}, { locale })
            : undefined
        }
      />
      <AsyncView
        result={connections}
        onRetry={refresh}
        errorMessage={listErrorMessage(locale)}
      >
        {(current) => {
          const rows = assistantRows(current, disconnected, locale);
          return rows.length === 0 ? (
            <EmptyState
              icon={Bot}
              dashed
              title={m.assistants_empty_title({}, { locale })}
              body={m.assistants_empty_connect({}, { locale })}
            >
              <Button
                variant="text"
                width="content"
                icon={ExternalLink}
                iconPlacement="end"
                label={m.assistants_how_connecting_works({}, { locale })}
                onPress={openConnectingHelp}
              />
            </EmptyState>
          ) : (
            <ListGroup>
              {rows.map((row) => (
                <AssistantConnectionRow
                  key={row.id}
                  row={row}
                  locale={locale}
                  onDisconnect={() => ask({ id: row.id, name: row.name })}
                />
              ))}
            </ListGroup>
          );
        }}
      </AsyncView>
      <ConfirmDialog
        visible={view.dialogOpen}
        title={m.assistants_disconnect_title({ name: targetName }, { locale })}
        body={m.assistants_disconnect_body({}, { locale })}
        confirmLabel={m.assistants_disconnect({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        destructive
        irreversible
        busy={view.busy}
        busyMessage={m.assistants_disconnecting({}, { locale })}
        onConfirm={() => {
          if (target !== undefined) disconnect(target.id);
        }}
        onCancel={() => setTarget(undefined)}
      >
        <LiveMessage
          role="alert"
          message={
            view.failed
              ? m.assistants_disconnect_failed({}, { locale })
              : undefined
          }
        />
      </ConfirmDialog>
    </ScrollScreen>
  );
}
