import type {
  CustomerBookingSelection,
  CustomerCheckoutSummary,
  CustomerCheckoutSummaryDiscount,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppLocale } from "../../../i18n/locale-context";
import { m } from "../../../i18n/messages";
import { AppBar } from "../../../ui/app-bar";
import { FocusedStatusBar } from "../../../ui/focused-status-bar";
import { useSample } from "../../../ui/gallery/gallery-kit";
import { color } from "../../../ui/tokens";
import { startCheckout } from "../../checkout/checkout-machine";
import {
  CheckoutCommand,
  type CheckoutDetails,
  CheckoutState,
  CodeStatus,
  type HeldCheckout,
  LegalDocuments,
  ReviewKind,
  type ReviewState,
} from "../../checkout/checkout-state";
import { ReviewStep } from "../../checkout-screen/review-step";
import { reviewBilling } from "../../checkout-screen/review-view";
import {
  czk,
  sampleLegalDocuments,
} from "../../testing/sample-booking-catalog";
import { HoldChip, HoldEndedDialog } from "../hold-timer";
import {
  openSpaceWithCoffee,
  reservedDeskWithWorkstation,
} from "../testing/price-fixtures";
import type { BoardFrame } from "./board-frames";

// Boards 32, 32b, 33 and 33b: the review step itself over synthetic review
// states, with the app bar's live hold chip. The hold's end is set when the
// frame opens, as many seconds away as the board's chip shows.

const ignore = () => undefined;
const selection = openSpaceWithCoffee.selection;
const quoted = czk(282);
const overnightSelection: CustomerBookingSelection = {
  ...reservedDeskWithWorkstation.selection,
  stay: "overnight",
};
const noonToNoon = { startTime: "12:00", endTime: "12:00" };

const calendar: CustomerCheckoutSummaryDiscount = {
  discount: { id: "calendar-sale-2026-11", label: "Calendar discount" },
  amount: czk(58),
};

const discount = (
  id: string,
  label: string,
  crowns: number
): CustomerCheckoutSummaryDiscount => ({
  discount: { id, label },
  amount: czk(crowns),
});

const openSpace = (
  amount: Money,
  discounts: ReadonlyArray<CustomerCheckoutSummaryDiscount>,
  total: Money
): CustomerCheckoutSummary => ({
  sections: [
    {
      key: "order",
      items: [
        {
          key: "product:cowork:open-space",
          amount,
          originalAmount: czk(290),
          ...(discounts.length > 0 ? { discounts: [...discounts] } : {}),
        },
        { key: "addon:coffee", amount: czk(50) },
      ],
      total,
    },
    { key: "total", items: [{ key: "total:final", amount: total }], total },
  ],
  total,
  vatStatus: "not-vat-payer",
});

const welcome10 = discount("code-welcome10", "Code WELCOME10", 23.2);
const withCode = openSpace(czk(208.8), [calendar, welcome10], czk(258.8));
const withReferralAndCode = openSpace(
  czk(185.6),
  [calendar, discount("referral", "Your referral discount", 23.2), welcome10],
  czk(235.6)
);
/** The calendar discount ended before paying: 290 + 50. */
const withoutSale: CustomerCheckoutSummary = {
  ...openSpace(czk(290), [], czk(340)),
  sections: [
    {
      key: "order",
      items: [
        { key: "product:cowork:open-space", amount: czk(290) },
        { key: "addon:coffee", amount: czk(50) },
      ],
      total: czk(340),
    },
    {
      key: "total",
      items: [{ key: "total:final", amount: czk(340) }],
      total: czk(340),
    },
  ],
};

const flow = (() => {
  const started = startCheckout({
    checkoutSessionId: "gallery-session",
    locale: "en-US",
    selection,
    advertisedPriceToken: "gallery-advertised",
    rememberedReferralCode: Option.none(),
  });
  if (started._tag !== "Details") throw new Error("checkout didn't start");
  return started.flow;
})();

const address = (city: string) => ({
  line1: "Křižíkova 12",
  city,
  postalCode: "186 00",
  country: "CZ",
});

type Sample = (text: string) => string;

const selfDetails = (sample: Sample): CheckoutDetails => ({
  bookingFor: "self",
  contact: {
    name: sample("Jana Nováková"),
    email: "jana.novakova@example.com",
    phone: "+420 601 234 567",
  },
  billing: {
    purpose: "personal",
    invoice: "requested",
    address: address(sample("Prague 8")),
  },
});

const guestDetails = (sample: Sample): CheckoutDetails => ({
  bookingFor: "someone-else",
  contact: {
    name: sample("Petr Svoboda"),
    email: "petr.svoboda@example.com",
    phone: "+420 602 345 678",
  },
  billing: {
    purpose: "business",
    invoice: "required",
    buyer: {
      kind: "business",
      legalName: sample("Svoboda Studio s.r.o."),
      companyId: "12345678",
      address: address(sample("Prague 7")),
    },
  },
});

const documents = LegalDocuments.Loaded({
  documents: sampleLegalDocuments("en-US", 1),
});

interface ReviewSample {
  readonly secondsLeft: number;
  readonly details?: (sample: Sample) => CheckoutDetails;
  readonly checkout?: Partial<HeldCheckout>;
  readonly code?: ReviewState["code"];
  readonly pending?: ReviewState["pending"];
  readonly consented?: boolean;
  /** An order paid again in place (board 35b). */
  readonly retry?: boolean;
  /** An overnight Reserved Desk stay, with the catalog's times. */
  readonly overnight?: boolean;
}

const reviewOf = (
  sample: Sample,
  holdExpiresAt: string,
  frame: ReviewSample
): ReviewState => {
  const details = (frame.details ?? selfDetails)(sample);
  return CheckoutState.Review({
    flow,
    kind: frame.retry
      ? ReviewKind.PaymentRetry({
          details: { ...details, billing: reviewBilling(details.billing) },
        })
      : ReviewKind.NewBooking({ details }),
    checkout: {
      orderId: "gallery-order",
      payStateToken: "gallery-token",
      holdExpiresAt,
      summary: openSpaceWithCoffee.summary,
      appliedDiscountCode: Option.none(),
      priceReview: Option.none(),
      earlyPerformanceConsent: {
        required: false,
        requiredFrom: "2026-12-10T09:00:00.000Z",
      },
      referralApplied: false,
      ...frame.checkout,
    },
    priceBefore: Option.none(),
    code: frame.code ?? { input: "", status: CodeStatus.Idle() },
    legal: documents,
    consent: frame.consented
      ? Option.some(documents.documents.map(({ key, hash }) => ({ key, hash })))
      : Option.none(),
    pending: frame.pending ?? Option.none(),
    notice: Option.none(),
  });
};

function ReviewFrame({
  onBack,
  frame,
  ended = false,
}: {
  readonly onBack: () => void;
  readonly frame: ReviewSample;
  readonly ended?: boolean;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  const [holdExpiresAt] = useState(() =>
    new Date(Date.now() + frame.secondsLeft * 1000).toISOString()
  );
  const review = reviewOf(sample, holdExpiresAt, frame);
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FocusedStatusBar style="dark" />
      <AppBar
        title={m.booking_review_title({}, { locale })}
        onBack={onBack}
        // A payment retry shows no hold timer, as the checkout screen does.
        actions={
          frame.retry ? undefined : (
            <HoldChip expiresAt={holdExpiresAt} locale={locale} />
          )
        }
      />
      <ReviewStep
        review={review}
        selection={frame.overnight ? overnightSelection : selection}
        overnightStay={frame.overnight ? noonToNoon : undefined}
        quotedTotal={
          frame.overnight ? reservedDeskWithWorkstation.summary.total : quoted
        }
        bookerName={Option.some(sample("Jana Nováková"))}
        send={ignore}
        onChangeBooking={ignore}
        onOpenDocument={ignore}
        locale={locale}
      />
      <HoldEndedDialog
        visible={ended}
        onCheckDate={ignore}
        onLeave={ignore}
        locale={locale}
      />
    </SafeAreaView>
  );
}

const welcome10Applied: Partial<HeldCheckout> = {
  summary: withCode,
  appliedDiscountCode: Option.some({
    code: "WELCOME10",
    discountId: "code-welcome10",
  }),
};

const applying = (input: string) =>
  Option.some(
    CheckoutCommand.ApplyDiscountCode({
      operationId: 1,
      request: { locale: "en-US", payStateToken: "gallery-token", code: input },
      referralCode: Option.none(),
    })
  );

const submitting = Option.some(
  CheckoutCommand.SubmitCheckout({
    operationId: 1,
    request: {
      locale: "en-US",
      payStateToken: "gallery-token",
      legalConsent: true,
      acceptedLegalDocuments: [],
    },
    referralCode: Option.none(),
  })
);

const frame =
  (sample: ReviewSample, ended = false): BoardFrame["Screen"] =>
  ({ onBack }) => <ReviewFrame onBack={onBack} frame={sample} ended={ended} />;

/** The review frames, in board order. */
export const reviewFrames: ReadonlyArray<BoardFrame> = [
  {
    key: "review",
    board: "32",
    state: "Review",
    Screen: frame({ secondsLeft: 597 }),
  },
  {
    key: "review-code-applied",
    board: "32",
    state: "Code applied",
    Screen: frame({ secondsLeft: 545, checkout: welcome10Applied }),
  },
  {
    key: "review-code-rejected",
    board: "32",
    state: "Code rejected",
    Screen: frame({
      secondsLeft: 532,
      code: {
        input: "SUMMER25",
        status: CodeStatus.Rejected({ reason: "unavailable" }),
      },
    }),
  },
  {
    key: "review-code-applying",
    board: "32b",
    state: "Applying a code",
    Screen: frame({
      secondsLeft: 560,
      code: { input: "WELCOME10", status: CodeStatus.Applying() },
      pending: applying("WELCOME10"),
    }),
  },
  {
    key: "review-someone-else",
    board: "32b",
    state: "Booked for someone else",
    Screen: frame({ secondsLeft: 597, details: guestDetails }),
  },
  {
    key: "review-referral-and-code",
    board: "32b",
    state: "Calendar sale, referral and code",
    Screen: frame({
      secondsLeft: 542,
      checkout: {
        ...welcome10Applied,
        summary: withReferralAndCode,
        referralApplied: true,
      },
    }),
  },
  {
    key: "review-last-minute",
    board: "33",
    state: "Last minute",
    Screen: frame({ secondsLeft: 58, consented: true }),
  },
  {
    key: "review-hold-ended",
    board: "33",
    state: "Hold ended",
    Screen: frame({ secondsLeft: -1, consented: true }, true),
  },
  {
    key: "review-price-changed",
    board: "33b",
    state: "Price changed",
    Screen: frame({
      secondsLeft: 450,
      consented: true,
      checkout: {
        summary: withoutSale,
        priceReview: Option.some({ sectionKeys: ["total"], itemKeys: [] }),
      },
    }),
  },
  {
    key: "review-early-consent",
    board: "34",
    state: "Agreement with early start",
    Screen: frame({
      secondsLeft: 482,
      checkout: {
        earlyPerformanceConsent: {
          required: true,
          requiredFrom: "2026-12-10T09:00:00.000Z",
        },
      },
    }),
  },
  {
    key: "review-ready-to-pay",
    board: "35",
    state: "Ready to pay",
    Screen: frame({
      secondsLeft: 511,
      consented: true,
      checkout: welcome10Applied,
    }),
  },
  {
    key: "review-opening-payment",
    board: "35",
    state: "Leaving for payment",
    Screen: frame({
      secondsLeft: 509,
      consented: true,
      checkout: welcome10Applied,
      pending: submitting,
    }),
  },
  {
    key: "review-payment-retry",
    board: "35b",
    state: "Payment cancelled or failed",
    Screen: frame({
      secondsLeft: 597,
      checkout: welcome10Applied,
      retry: true,
    }),
  },
  {
    key: "review-retry-overnight",
    board: "35b",
    state: "Overnight stay paid again",
    Screen: frame({
      secondsLeft: 597,
      checkout: { summary: reservedDeskWithWorkstation.summary },
      retry: true,
      overnight: true,
    }),
  },
];

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
});
