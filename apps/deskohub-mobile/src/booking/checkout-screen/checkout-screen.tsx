import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Redirect,
  Stack,
  useIsFocused,
  useNavigation,
  useRouter,
} from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { accountSectionHref } from "../../account/account-gating";
import { initialsOf } from "../../account/account-root-model";
import { legalDocumentUrl } from "../../account/legal/legal-documents";
import { apiOrigin } from "../../auth/auth-client";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { type AppLocale, isAppLocale } from "../../i18n/app-locale";
import { useDeviceCountry } from "../../i18n/device-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { openSitePage } from "../../routing/open-site-page";
import { LoadingState } from "../../ui/async-states";
import { Button } from "../../ui/controls";
import { StackHeader } from "../../ui/navigation";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { space } from "../../ui/tokens";
import { QuietUpdateOffer } from "../../updates/update-offer-card";
import { bookFamilyHref, bookHref, bookProfileHref } from "../booking-routes";
import type {
  CheckoutRestartReason,
  CheckoutRetryKind,
} from "../checkout/booking-problem";
import {
  type BookingRequest,
  type CheckoutController,
  type CheckoutRequest,
  checkoutOvernightStay,
  checkoutRequestAtom,
  useCheckoutFlow,
} from "../checkout/checkout-flow";
import {
  CheckoutEvent,
  type CheckoutState,
  type DetailsState,
  type ReviewState,
} from "../checkout/checkout-state";
import { bookingOfferingsAtom } from "../data/booking-queries";
import { quotedBarSummary } from "../ui/booking-summary";
import { HoldChip, HoldEndedDialog } from "../ui/hold-timer";
import { retryMessage } from "./checkout-copy";
import { useCheckoutLayout } from "./checkout-layout";
import {
  checkoutDestination,
  holdEndedReview,
  leaveCheckout,
} from "./checkout-navigation";
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
    onNone: () => <Redirect href={bookHref} />,
    onSome: (current) => <CheckoutFlowScreen request={current} />,
  });
}

function CheckoutFlowScreen({
  request,
}: {
  readonly request: CheckoutRequest;
}) {
  const locale = useAppLocale();
  const { contentWidth } = useCheckoutLayout();
  // Blurred, the flow holds the payment page until the screen is back (R8).
  const focused = useIsFocused();
  const navigation = useNavigation();
  const flow = useCheckoutFlow(request, {
    focused,
    isFocused: () => navigation.isFocused(),
  });
  const family = request.selection.family;
  const state = flow.view._tag === "Running" ? flow.view.state : undefined;
  // The review a hold runs out on stays under the hold-ended dialog.
  const [lastReview, setLastReview] = useState<Option.Option<ReviewState>>(
    Option.none()
  );
  if (state?._tag === "Review" && Option.getOrUndefined(lastReview) !== state) {
    setLastReview(Option.some(state));
  }
  // A payment retry shows no hold timer (the server still ends its hold):
  // one that runs out goes back to the order's ticket, without the dialog.
  const retriedOrderId =
    request._tag === "PaymentRetry" ? request.checkout.orderId : undefined;
  const ended =
    retriedOrderId === undefined
      ? holdEndedReview(flow.view, lastReview)
      : Option.none();
  useCheckoutNavigation(
    flow.view,
    family,
    Option.isSome(ended),
    retriedOrderId
  );
  // The details outlive this screen (back, a restarted hold) until the
  // booking is submitted.
  const setDraft = useAtomSet(detailsDraftAtom);
  // A payment retry never touched the draft of a booking in progress.
  const submitted =
    request._tag === "Booking" &&
    state !== undefined &&
    !keepsDetailsDraft(state);
  useEffect(() => {
    if (submitted) setDraft(Option.none());
  }, [submitted, setDraft]);
  const onDetails = state?._tag === "Details" || state?._tag === "Creating";
  // While the payment page opens, the review stays with Pay saying so.
  const opening =
    state?._tag === "Paying" && Option.isSome(state.opening)
      ? Option.some(state.review)
      : Option.none();
  const review =
    state?._tag === "Review"
      ? Option.some(state)
      : Option.orElse(opening, () => ended);
  // Set on every state: options a screen sets outlive the element.
  const title = (
    <Stack.Screen
      options={{
        title: checkoutTitle(onDetails, Option.isSome(review), locale),
        header: (props) => (
          <StackHeader
            {...props}
            contentWidth={
              onDetails || Option.isSome(review) ? contentWidth : "form"
            }
          />
        ),
        headerRight: Option.match(
          Option.filter(review, () => retriedOrderId === undefined),
          {
            onNone: () => undefined,
            onSome: (shown) => () => (
              <HoldChip
                expiresAt={shown.checkout.holdExpiresAt}
                locale={locale}
              />
            ),
          }
        ),
      }}
    />
  );
  if (Option.isSome(review)) {
    return (
      <>
        {title}
        <ReviewForAccount
          review={review.value}
          ended={Option.isSome(ended)}
          opening={Option.isSome(opening)}
          flow={flow}
          request={request}
          locale={locale}
        />
      </>
    );
  }
  if (
    request._tag === "Booking" &&
    (state?._tag === "Details" || state?._tag === "Creating")
  ) {
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
      <QuietUpdateOffer backdrop="paper" />
      {title}
      {state === undefined ? (
        <LoadingState label={m.booking_checkout_starting({}, { locale })} />
      ) : (
        <CheckoutStateView
          state={state}
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
  flow,
  request,
  locale,
}: {
  readonly state: CheckoutState;
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
      // Shown by `ReviewForAccount` in its own layout.
      return null;
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

const checkoutTitle = (
  onDetails: boolean,
  onReview: boolean,
  locale: AppLocale
) => {
  if (onDetails) return m.booking_details_title({}, { locale });
  return onReview
    ? m.booking_review_title({}, { locale })
    : m.booking_stack_checkout_title({}, { locale });
};

/**
 * The review step with the account's own name for "Booked by". `ended`: the
 * hold ran out on it; the hold-ended dialog over it offers checking the
 * date again, with the choices and details kept, or leaving the booking.
 */
function ReviewForAccount({
  review,
  ended,
  opening,
  flow,
  request,
  locale,
}: {
  readonly review: ReviewState;
  readonly ended: boolean;
  /** The payment page is opening over this review. */
  readonly opening: boolean;
  readonly flow: CheckoutController;
  readonly request: CheckoutRequest;
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const account = useAtomValue(accountAtom);
  const family = request.selection.family;
  const bookerName = AsyncResult.value(account).pipe(
    Option.flatMap((current) => {
      const access = detailsAccess(current);
      return access._tag === "Unavailable" ? Option.none() : access.self.name;
    })
  );
  const catalog = useAtomValue(bookingOfferingsAtom(locale));
  const overnightStay = checkoutOvernightStay(
    request,
    Option.map(AsyncResult.value(catalog), ({ offerings }) => offerings)
  );
  const backToSelection = (restart?: CheckoutRestartReason) =>
    leaveCheckout(router, {
      _tag: "FamilyScreen",
      href: bookFamilyHref(family, restart),
    });
  return (
    <>
      <ReviewStep
        review={review}
        selection={request.selection}
        overnightStay={overnightStay}
        quotedTotal={
          request._tag === "Booking"
            ? request.quote.summary.total
            : request.previousTotal
        }
        bookerName={bookerName}
        send={ended || opening ? ignoreIntent : flow.send}
        onChangeBooking={() => backToSelection()}
        keyboardOffset={headerHeight}
        onOpenDocument={(document) =>
          void openSitePage(new URL(document.path, apiOrigin).href)
        }
        locale={locale}
      />
      <HoldEndedDialog
        visible={ended}
        onCheckDate={() => backToSelection("hold_expired")}
        onLeave={() => router.dismissTo(bookHref)}
        locale={locale}
      />
    </>
  );
}

/**
 * A review the hold ran out on, or one the payment page is opening over,
 * takes no more intents.
 */
const ignoreIntent = () => undefined;

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
  readonly request: BookingRequest;
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
              <QuietUpdateOffer backdrop="paper" />
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
  readonly request: BookingRequest;
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const deviceCountry = useDeviceCountry();
  const [draft, setDraft] = useDetailsDraft(() =>
    initialDetailsDraft(profile.saved, deviceCountry)
  );
  const consentLocale = isAppLocale(request.locale) ? request.locale : locale;
  return (
    <DetailsStep
      keyboardOffset={headerHeight}
      profile={profile}
      initials={initials}
      onEditProfile={
        linked ? Option.some(() => router.push(bookProfileHref)) : Option.none()
      }
      draft={draft}
      onDraftChange={setDraft}
      notice={notice}
      busy={busy}
      summary={quotedBarSummary(
        request.selection,
        request.quote,
        locale,
        request.overnightStay === undefined
          ? {}
          : { overnightStay: request.overnightStay }
      )}
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
          onPress: () => router.push(accountSectionHref.complete),
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
  group: { gap: space.lg },
});
