import {
  RegistryContext,
  useAtom,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { Effect, Match, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import ChartColumn from "lucide-react-native/icons/chart-column";
import FileText from "lucide-react-native/icons/file-text";
import Megaphone from "lucide-react-native/icons/megaphone";
import { useContext, useEffect, useState } from "react";
import { apiOrigin } from "../../auth/auth-client";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { appForegroundAtom } from "../../platform/app-foreground";
import { openSitePage } from "../../routing/open-site-page";
import { LiveMessage } from "../../ui/controls";
import type { IconComponent } from "../../ui/icon";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { SkeletonGroup, SkeletonRow } from "../../ui/skeleton";
import { SwitchRow } from "../../ui/switch";
import { useToast } from "../../ui/toast";
import { useViewport } from "../../ui/viewport";
import {
  type AnalyticsSaveFeedback,
  analyticsPreferenceAtom,
  analyticsSwitchView,
  followAnalyticsPreference,
  isAnalyticsPreferenceUnavailable,
  saveAnalyticsPreferenceAtom,
} from "./analytics-preference";
import { DataExportRow } from "./data-export-row";
import {
  type LegalDocument,
  legalDocuments,
  legalDocumentUrl,
} from "./legal-documents";
import {
  isMarketingPreferenceUnavailable,
  type MarketingSaveFeedback,
  marketingPreferencesAtom,
  marketingSwitchView,
  saveMarketingPreferenceAtom,
} from "./marketing-preferences";
import type { PreferenceSwitchState } from "./preference-switch";

const documentLabel = (document: LegalDocument, locale: AppLocale) =>
  ({
    privacy: m.legal_document_privacy,
    marketing: m.legal_document_marketing,
    terms: m.legal_document_terms,
    cookies: m.legal_document_cookies,
  })[document]({}, { locale });

// Opens a document in the in-app browser; it fails where no browser is
// available.
const openDocumentAtom = Atom.fn((url: string) =>
  Effect.tryPromise(() => openSitePage(url))
);

/**
 * Legal & Privacy: the site's legal documents (opened in the in-app
 * browser), a linked account's marketing consent, the signed-in account's
 * analytics preference, and the data archive the account doesn't offer yet.
 * The analytics preference is the account's, whatever its profile's state,
 * as on the site; the app's own analytics answer comes from its consent
 * prompt and follows the account's decisions. The other cookie
 * categories are a website setting the app doesn't manage; the cookie policy
 * describes them.
 */
export function LegalScreen() {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const account = useAtomValue(accountAtom);
  const refreshAccount = useAtomRefresh(accountAtom);
  const registry = useContext(RegistryContext);
  const [opened, openDocument] = useAtom(openDocumentAtom);
  const linked = Option.exists(
    AsyncResult.value(account),
    (current) => current.kind === "linked"
  );
  // Only a linked account's screen shows (and so reads) marketing consent.
  const refresh = () => {
    refreshAccount();
    registry.refresh(analyticsPreferenceAtom);
    if (linked) registry.refresh(marketingPreferencesAtom);
  };
  const openPrivacyPolicy = () =>
    openDocument(legalDocumentUrl("privacy", apiOrigin));

  return (
    <ScrollScreen
      refreshing={account.waiting && !AsyncResult.isInitial(account)}
      onRefresh={refresh}
    >
      <SectionHeader first title={m.legal_documents_heading({}, { locale })} />
      <ListGroup>
        {legalDocuments.map((document) => (
          <ListRow
            key={document}
            icon={FileText}
            label={documentLabel(document, locale)}
            trailing="external"
            onPress={() => openDocument(legalDocumentUrl(document, apiOrigin))}
          />
        ))}
      </ListGroup>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="alert"
        message={
          AsyncResult.isFailure(opened)
            ? m.legal_document_open_failed({}, { locale })
            : undefined
        }
      />
      <SectionHeader title={m.legal_marketing_heading({}, { locale })} />
      <AsyncView
        result={account}
        onRetry={refreshAccount}
        loading={<PreferenceSkeleton />}
      >
        {(current) =>
          current.kind === "linked" ? (
            <MarketingPreference isWide={isWide} />
          ) : (
            <ListGroup>
              <ListRow label={m.legal_marketing_unavailable({}, { locale })} />
            </ListGroup>
          )
        }
      </AsyncView>
      <SectionHeader title={m.legal_analytics_heading({}, { locale })} />
      <AnalyticsPreference
        isWide={isWide}
        onOpenPrivacyPolicy={openPrivacyPolicy}
      />
      <SectionHeader title={m.legal_archive_heading({}, { locale })} />
      <DataExportRow />
    </ScrollScreen>
  );
}

const feedbackMessage = (
  feedback: MarketingSaveFeedback,
  locale: AppLocale
):
  | { readonly role: "status" | "alert"; readonly message: string }
  | undefined =>
  Match.value(feedback).pipe(
    Match.discriminatorsExhaustive("kind")({
      saving: () => ({
        role: "status" as const,
        message: m.legal_marketing_saving({}, { locale }),
      }),
      // The toast confirms the new state.
      saved: () => undefined,
      stale: () => ({
        role: "alert" as const,
        message: m.legal_marketing_stale({}, { locale }),
      }),
      unconfirmed: () => ({
        role: "alert" as const,
        message: m.account_save_unconfirmed({}, { locale }),
      }),
      // An unexpected failure gets this screen's own sentence.
      failed: ({ error }) => ({
        role: "alert" as const,
        message:
          (error._tag === "Unexpected"
            ? undefined
            : sharedViewErrorMessage(error, locale)) ??
          m.legal_marketing_save_failed({}, { locale }),
      }),
    })
  );

/** The linked account's marketing consent switch. */
function MarketingPreference({ isWide }: { readonly isWide: boolean }) {
  const locale = useAppLocale();
  const preferences = useAtomValue(marketingPreferencesAtom);
  const refresh = useAtomRefresh(marketingPreferencesAtom);
  const [save, choose] = useAtom(saveMarketingPreferenceAtom);
  const [requested, setRequested] = useState<boolean>();
  const toast = useToast();

  const view = marketingSwitchView({ preferences, save, requested });
  const feedback =
    view.feedback === undefined
      ? undefined
      : feedbackMessage(view.feedback, locale);
  const saved = view.feedback?.kind === "saved";
  // A save confirms the state it saved: turned on, or turned off.
  useEffect(() => {
    if (!saved) return;
    toast.show({
      message: (view.granted
        ? m.legal_marketing_turned_on
        : m.legal_marketing_turned_off)({}, { locale }),
      tone: "confirmation",
    });
  }, [saved, view.granted, toast, locale]);

  return (
    <>
      <AsyncView
        result={preferences}
        onRetry={refresh}
        loading={<PreferenceSkeleton />}
        errorMessage={(error) =>
          isMarketingPreferenceUnavailable(error)
            ? m.legal_marketing_unavailable({}, { locale })
            : undefined
        }
      >
        {(current) => (
          <ListGroup>
            <PreferenceSwitch
              icon={Megaphone}
              label={m.legal_marketing_switch_label({}, { locale })}
              description={(isWide
                ? m.legal_marketing_description_wide
                : m.legal_marketing_description)({}, { locale })}
              view={view}
              saving={view.feedback?.kind === "saving"}
              onChange={(granted) => {
                setRequested(granted);
                choose({ context: current.context, granted, locale });
              }}
            />
          </ListGroup>
        )}
      </AsyncView>
      <FeedbackMessages feedback={feedback} />
    </>
  );
}

const analyticsFeedbackMessage = (
  feedback: AnalyticsSaveFeedback,
  locale: AppLocale
): { readonly role: "status" | "alert"; readonly message: string } =>
  Match.value(feedback).pipe(
    Match.discriminatorsExhaustive("kind")({
      saving: () => ({
        role: "status" as const,
        message: m.legal_analytics_saving({}, { locale }),
      }),
      saved: () => ({
        role: "status" as const,
        message: m.legal_analytics_saved({}, { locale }),
      }),
      unconfirmed: () => ({
        role: "alert" as const,
        message: m.account_save_unconfirmed({}, { locale }),
      }),
      failed: ({ error }) => ({
        role: "alert" as const,
        message:
          (error._tag === "Unexpected"
            ? undefined
            : sharedViewErrorMessage(error, locale)) ??
          m.legal_analytics_save_failed({}, { locale }),
      }),
    })
  );

/**
 * The signed-in account's analytics preference switch, read again on each
 * return to the foreground. A saved choice also becomes this device's
 * analytics answer. While the preference can't be
 * read there is no switch, so it never reads as off.
 */
function AnalyticsPreference({
  isWide,
  onOpenPrivacyPolicy,
}: {
  readonly isWide: boolean;
  readonly onOpenPrivacyPolicy: () => void;
}) {
  const locale = useAppLocale();
  const registry = useContext(RegistryContext);
  const preference = useAtomValue(analyticsPreferenceAtom);
  const refresh = useAtomRefresh(analyticsPreferenceAtom);
  useEffect(
    () =>
      followAnalyticsPreference({ registry, foreground: appForegroundAtom }),
    [registry]
  );
  const [save, choose] = useAtom(saveAnalyticsPreferenceAtom);
  const [requested, setRequested] = useState<boolean>();

  const view = analyticsSwitchView({ preference, save, requested });
  const feedback =
    view.feedback === undefined
      ? undefined
      : analyticsFeedbackMessage(view.feedback, locale);

  return (
    <>
      <AsyncView
        result={preference}
        onRetry={refresh}
        loading={<PreferenceSkeleton />}
        errorMessage={(error) =>
          isAnalyticsPreferenceUnavailable(error)
            ? m.legal_analytics_unavailable({}, { locale })
            : undefined
        }
      >
        {() => (
          <ListGroup>
            <PreferenceSwitch
              icon={ChartColumn}
              label={(isWide
                ? m.legal_analytics_switch_label_wide
                : m.legal_analytics_switch_label)({}, { locale })}
              description={(isWide
                ? m.legal_analytics_description_wide
                : m.legal_analytics_description)({}, { locale })}
              view={view}
              saving={view.feedback?.kind === "saving"}
              onChange={(granted) => {
                setRequested(granted);
                choose({ granted, locale });
              }}
            />
            {!isWide && (
              <ListRow
                icon={FileText}
                label={m.legal_document_privacy({}, { locale })}
                trailing="external"
                onPress={onOpenPrivacyPolicy}
              />
            )}
          </ListGroup>
        )}
      </AsyncView>
      <FeedbackMessages feedback={feedback} />
    </>
  );
}

/**
 * A switch row over a saved account preference. While a change saves, the
 * switch shows its new position and ignores presses.
 */
function PreferenceSwitch({
  icon,
  label,
  description,
  view,
  saving,
  onChange,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly description: string;
  readonly view: PreferenceSwitchState;
  readonly saving: boolean;
  readonly onChange: (granted: boolean) => void;
}) {
  return (
    <SwitchRow
      icon={icon}
      label={label}
      description={description}
      value={view.granted}
      busy={saving}
      disabled={!view.enabled && !saving}
      onValueChange={onChange}
    />
  );
}

/** A preference switch row while it loads, in its final size. */
function PreferenceSkeleton() {
  const locale = useAppLocale();
  return (
    <SkeletonGroup label={m.account_loading({}, { locale })}>
      <ListGroup>
        <SkeletonRow icon lines={2} />
      </ListGroup>
    </SkeletonGroup>
  );
}

/** A preference save's feedback, kept mounted so assistive tech announces each change. */
function FeedbackMessages({
  feedback,
}: {
  readonly feedback:
    | { readonly role: "status" | "alert"; readonly message: string }
    | undefined;
}) {
  return (
    <>
      <LiveMessage
        role="status"
        message={feedback?.role === "status" ? feedback.message : undefined}
      />
      <LiveMessage
        role="alert"
        message={feedback?.role === "alert" ? feedback.message : undefined}
      />
    </>
  );
}
