import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import {
  Redirect,
  Stack,
  useIsFocused,
  useNavigation,
  useRouter,
} from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { legalDocumentUrl } from "../../account/legal/legal-documents";
import { initialsOf } from "../../account/profile/profile-screen";
import { apiOrigin } from "../../auth/auth-client";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { type AppLocale, isAppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LoadingState } from "../../ui/async-states";
import { Button } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { bookProfileHref } from "../booking-routes";
import type { CheckoutRetryKind } from "../checkout/booking-problem";
import {
  type CheckoutController,
  type CheckoutRequest,
  checkoutRequestAtom,
  useCheckoutFlow,
} from "../checkout/checkout-flow";
import {
  CheckoutEvent,
  type CheckoutState,
  type DetailsState,
} from "../checkout/checkout-state";
import { quotedBarSummary } from "../ui/booking-summary";
import { retryMessage } from "./checkout-copy";
import { checkoutDestination, leaveCheckout } from "./checkout-navigation";
import {
  detailsDraftAtom,
  keepsDetailsDraft,
  useDetailsDraft,
} from "./details-draft";
import {
  type DetailsProfile,
  detailsAccess,
  initialDetailsDraft,
} from "./details-form";
import { DetailsStep } from "./details-step";
import { ReviewStep } from "./review-step";
import { useCheckoutNavigation } from "./use-checkout-navigation";

/**
 * `/book/checkout`: the checkout a family screen asked for. Without one
 * (such as after a web reload) it returns to the booking start.
 */
export function CheckoutScreen() {
  const request = useAtomValue(checkoutRequestAtom);
  return Option.match(request, {
    onNone: () => <Redirect href="/book" />,
    onSome: (current) => <CheckoutFlowScreen request={current} />,
  });
}

function CheckoutFlowScreen({
  request,
}: {
  readonly request: CheckoutRequest;
}) {
  const locale = useAppLocale();
  // Blurred, the flow holds the payment page until the screen is back (R8).
  const focused = useIsFocused();
  const navigation = useNavigation();
  const flow = useCheckoutFlow(request, {
    focused,
    isFocused: () => navigation.isFocused(),
  });
  const family = request.selection.family;
  useCheckoutNavigation(flow.view, family);
  // The details outlive this screen (back, a restarted hold) until the
  // booking is submitted.
  const setDraft = useAtomSet(detailsDraftAtom);
  const state = flow.view._tag === "Running" ? flow.view.state : undefined;
  const submitted = state !== undefined && !keepsDetailsDraft(state);
  useEffect(() => {
    if (submitted) setDraft(Option.none());
  }, [submitted, setDraft]);
  const onDetails = state?._tag === "Details" || state?._tag === "Creating";
  // Set on every state: options a screen sets outlive the element.
  const title = (
    <Stack.Screen
      options={{
        title: onDetails
          ? m.booking_details_title({}, { locale })
          : m.booking_stack_checkout_title({}, { locale }),
      }}
    />
  );
  if (state?._tag === "Details" || state?._tag === "Creating") {
    return (
      <>
        {title}
        <DetailsForAccount
          notice={state._tag === "Details" ? state.notice : Option.none()}
          busy={state._tag === "Creating"}
          flow={flow}
          request={request}
          locale={locale}
        />
      </>
    );
  }
  return (
    <ScrollScreen>
      {title}
      {state === undefined ? (
        <LoadingState label={m.booking_checkout_starting({}, { locale })} />
      ) : (
        <CheckoutStateView
          state={state}
          now={flow.view._tag === "Running" ? flow.view.now : 0}
          flow={flow}
          request={request}
          locale={locale}
        />
      )}
    </ScrollScreen>
  );
}

function CheckoutStateView({
  state,
  now,
  flow,
  request,
  locale,
}: {
  readonly state: CheckoutState;
  readonly now: number;
  readonly flow: CheckoutController;
  readonly request: CheckoutRequest;
  readonly locale: AppLocale;
}) {
  const retry = () => flow.send(CheckoutEvent.Retry());
  switch (state._tag) {
    case "Details":
    case "Creating":
      // Shown by `DetailsForAccount` in its own layout.
      return null;
    case "Review":
      return (
        <ReviewStep
          review={state}
          now={now}
          selection={request.selection}
          send={flow.send}
          locale={locale}
        />
      );
    case "Uncertain":
      return (
        <StatusNotice
          tone="warning"
          message={m.booking_checkout_unconfirmed({}, { locale })}
          detail={state.notice}
          action={{
            label: m.booking_checkout_retry({}, { locale }),
            onPress: retry,
            disabled: state.retrying,
          }}
          locale={locale}
        />
      );
    case "Paying":
      // A payment page held while the screen was out of view opens as soon
      // as it's back, so this notice is all the held state needs.
      return (
        <StatusNotice
          tone="info"
          message={m.booking_checkout_payment_open({}, { locale })}
          detail={state.notice}
          action={
            Option.isSome(state.notice) && Option.isNone(state.opening)
              ? {
                  label: m.booking_checkout_payment_reopen({}, { locale }),
                  onPress: retry,
                  disabled: false,
                }
              : undefined
          }
          locale={locale}
        />
      );
    case "Done":
    case "Restart":
      return <FinishedNotice state={state} request={request} locale={locale} />;
    case "Blocked":
      return <BlockedNotice reason={state.reason} locale={locale} />;
  }
}

function DetailsForAccount({
  notice,
  busy,
  flow,
  request,
  locale,
}: {
  readonly notice: DetailsState["notice"];
  readonly busy: boolean;
  readonly flow: CheckoutController;
  readonly request: CheckoutRequest;
  readonly locale: AppLocale;
}) {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  return (
    <AsyncView result={account} onRetry={refresh}>
      {(current) => {
        const access = detailsAccess(current);
        if (access._tag === "Unavailable") {
          return (
            <ScrollScreen>
              <AccountUnavailableNotice
                reason={access.reason}
                locale={locale}
              />
            </ScrollScreen>
          );
        }
        return (
          <DetailsWithProfile
            profile={access}
            initials={
              current.kind === "linked" && Option.isSome(access.self.name)
                ? Option.some(initialsOf(current.profile))
                : Option.none()
            }
            linked={current.kind === "linked"}
            notice={notice}
            busy={busy}
            flow={flow}
            request={request}
            locale={locale}
          />
        );
      }}
    </AsyncView>
  );
}

function DetailsWithProfile({
  profile,
  initials,
  linked,
  notice,
  busy,
  flow,
  request,
  locale,
}: {
  readonly profile: DetailsProfile;
  readonly initials: Option.Option<string>;
  readonly linked: boolean;
  readonly notice: DetailsState["notice"];
  readonly busy: boolean;
  readonly flow: CheckoutController;
  readonly request: CheckoutRequest;
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  const [draft, setDraft] = useDetailsDraft(() =>
    initialDetailsDraft(profile.saved)
  );
  const consentLocale = isAppLocale(request.locale) ? request.locale : locale;
  return (
    <DetailsStep
      profile={profile}
      initials={initials}
      onEditProfile={
        linked ? Option.some(() => router.push(bookProfileHref)) : Option.none()
      }
      draft={draft}
      onDraftChange={setDraft}
      notice={notice}
      busy={busy}
      summary={quotedBarSummary(request.selection, request.quote, locale)}
      consentLocale={consentLocale}
      onOpenMarketingDocument={() =>
        void WebBrowser.openBrowserAsync(
          legalDocumentUrl("marketing", apiOrigin, consentLocale)
        )
      }
      onContinue={flow.continueWith}
      onRetry={() => flow.send(CheckoutEvent.Retry())}
      locale={locale}
    />
  );
}

interface NoticeAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
}

function StatusNotice({
  tone,
  message,
  detail,
  action,
  locale,
}: {
  readonly tone: "info" | "warning" | "error";
  readonly message: string;
  /** Why the last attempt failed, below the message. */
  readonly detail?: Option.Option<CheckoutRetryKind>;
  readonly action?: NoticeAction;
  readonly locale: AppLocale;
}) {
  const detailKind =
    detail === undefined ? undefined : Option.getOrUndefined(detail);
  return (
    <View style={styles.group}>
      <Notice tone={tone} message={message} />
      <Notice
        tone="error"
        message={detailKind && retryMessage(detailKind, locale)}
      />
      {action !== undefined && (
        <Button
          label={action.label}
          onPress={action.onPress}
          disabled={action.disabled}
        />
      )}
    </View>
  );
}

/**
 * A finished checkout normally leaves at once; this shows only when it
 * finished while the customer was elsewhere (R8), so they can go on.
 */
function FinishedNotice({
  state,
  request,
  locale,
}: {
  readonly state: Extract<CheckoutState, { readonly _tag: "Done" | "Restart" }>;
  readonly request: CheckoutRequest;
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  const destination = checkoutDestination(
    { _tag: "Running", state, now: 0 },
    request.selection.family
  );
  const done = state._tag === "Done";
  return (
    <StatusNotice
      tone="info"
      message={
        done
          ? m.booking_checkout_done({}, { locale })
          : m.booking_checkout_restart({}, { locale })
      }
      action={
        destination === undefined
          ? undefined
          : {
              label: done
                ? m.booking_checkout_show_status({}, { locale })
                : m.booking_checkout_back_to_booking({}, { locale }),
              onPress: () => leaveCheckout(router, destination),
              disabled: false,
            }
      }
      locale={locale}
    />
  );
}

function BlockedNotice({
  reason,
  locale,
}: {
  readonly reason: Extract<
    CheckoutState,
    { readonly _tag: "Blocked" }
  >["reason"];
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  if (reason === "profile-missing") {
    return (
      <StatusNotice
        tone="warning"
        message={m.booking_checkout_blocked_profile_missing({}, { locale })}
        action={{
          label: m.booking_checkout_complete_profile({}, { locale }),
          onPress: () => router.push("/account/complete"),
          disabled: false,
        }}
        locale={locale}
      />
    );
  }
  return (
    <StatusNotice
      tone="warning"
      message={{
        "support-required": () =>
          m.booking_checkout_blocked_support_required({}, { locale }),
        "deletion-pending": () =>
          m.booking_checkout_blocked_deletion_pending({}, { locale }),
        "payment-disabled": () =>
          m.booking_checkout_blocked_payment_disabled({}, { locale }),
      }[reason]()}
      locale={locale}
    />
  );
}

function AccountUnavailableNotice({
  reason,
  locale,
}: {
  readonly reason:
    | "support-required"
    | "deletion-pending"
    | "authenticated-unavailable";
  readonly locale: AppLocale;
}) {
  return (
    <StatusNotice
      tone="warning"
      message={{
        "support-required": () =>
          m.booking_checkout_blocked_support_required({}, { locale }),
        "deletion-pending": () =>
          m.booking_checkout_blocked_deletion_pending({}, { locale }),
        "authenticated-unavailable": () =>
          m.booking_checkout_blocked_account_unavailable({}, { locale }),
      }[reason]()}
      locale={locale}
    />
  );
}

const styles = StyleSheet.create({
  group: { gap: theme.spacing.md },
});
