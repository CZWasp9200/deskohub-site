import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { CheckoutUnavailableError } from "@/features/checkout/backend/checkout/checkout-unavailable";
import { makeOfficePayRouteFixture } from "@/features/checkout/backend/checkout/office-pay-route.test-utils";
import type { PayableReservation } from "@/features/checkout/backend/checkout/payable-checkout.service";
import { PayableCheckoutMock } from "@/features/checkout/backend/checkout/payable-checkout.service.mock";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import type { Locale } from "@/features/i18n";
import type { OfficeCheckoutPeople } from "@/features/office/components/office-checkout-people";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationCheckoutStepQueryParam } from "@/features/reservation/reservation-checkout-step";
import {
  getCoworkReservationPath,
  getReservationStartPath,
} from "@/features/reservation/routes";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import type { SearchParamsRecord } from "@/shared/utils";
import { instantStringSchema } from "@/shared/utils/temporal";

mock.module("server-only", () => ({}));

/** Configures the page's key ring as a value that doesn't parse. */
let keyRingMalformed = false;
mock.module("@/shared/backend/sealed-state-keys-provider.server", () => ({
  makeSealedStateKeysLayer: () =>
    SealedStateKeys.fromConfiguration(
      keyRingMalformed
        ? "malformed"
        : (process.env.CHECKOUT_PAY_STATE_KEYS ?? "")
    ),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));

/** Whether the held reservation behind the Pay state can still be paid. */
let reservationPayable = true;
const payableCheckoutModule = await import(
  "@/features/checkout/backend/checkout/payable-checkout.service"
);
class PayableCheckout extends payableCheckoutModule.PayableCheckout {
  static override Live = PayableCheckoutMock((state) =>
    reservationPayable
      ? Effect.succeed({
          id: state.orderId,
          reservationState: "held",
          paymentState: "not_started",
          dotyposCustomerId: "1001",
          dotyposReservationId: "dotypos-reservation-id",
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2099-06-01T10:08:00.000Z"
          ),
        } as PayableReservation)
      : Effect.fail(
          new CheckoutUnavailableError({
            orderId: state.orderId,
            reason: "not_held",
            restartKind: state.reservation.kind,
          })
        )
  ).pipe(Layer.provide(SealedStateKeys.Default));
}
mock.module(
  "@/features/checkout/backend/checkout/payable-checkout.service",
  () => ({ ...payableCheckoutModule, PayableCheckout })
);

let discountCodeEntryEnabled = true;
mock.module("@/features/discounts/discount-code-entry.server", () => ({
  getDiscountCodeEntryEnabled: Effect.suspend(() =>
    Effect.succeed(discountCodeEntryEnabled)
  ),
}));

const officeCheckout = makeOfficePayRouteFixture();
const checkoutView = await import(
  "@/features/checkout/backend/checkout/pay-state-checkout-view"
);
mock.module(
  "@/features/checkout/backend/checkout/pay-state-checkout-view",
  () => ({
    ...checkoutView,
    checkoutOfficePeopleForVisitorServices: officeCheckout.services,
  })
);

type LinkProps = { readonly href: string };
const flowLayout = await import(
  "@/features/checkout/components/checkout-flow-layout"
);
mock.module("@/features/checkout/components/checkout-flow-layout", () => ({
  ...flowLayout,
  CheckoutFlowLayout: ({
    children,
    stepLinks,
  }: {
    readonly children: ReactNode;
    readonly stepLinks?: {
      readonly chooseSpace: LinkProps;
      readonly contact: LinkProps;
    };
  }) => (
    <section
      data-choose-space={stepLinks?.chooseSpace.href}
      data-contact={stepLinks?.contact.href}
    >
      {children}
    </section>
  ),
}));
mock.module("@/features/checkout/components/checkout-pay-page", () => ({
  CheckoutPayPage: ({
    discountCodeForm,
    earlyPerformanceRequestRequired,
    freshPayUrl,
    payStateToken,
    people,
    variant,
  }: {
    readonly discountCodeForm: ReactNode;
    readonly earlyPerformanceRequestRequired: boolean;
    readonly freshPayUrl?: string;
    readonly payStateToken?: string;
    readonly people?: OfficeCheckoutPeople;
    readonly variant: string;
  }) => (
    <article
      data-early-performance={String(earlyPerformanceRequestRequired)}
      data-fresh-pay-url={freshPayUrl}
      data-pay-state-token={payStateToken}
      data-booker-email={people?.contact.email}
      data-booker-name={people?.contact.name}
      data-invitee-email={people?.invitees[0]}
      data-variant={variant}
    >
      {discountCodeForm}
    </article>
  ),
}));
mock.module(
  "@/features/checkout/components/checkout-discount-code-form",
  () => ({
    CheckoutDiscountCodeForm: ({
      enabled,
      referralApplied,
      rejection,
    }: {
      readonly enabled: boolean;
      readonly referralApplied: boolean;
      readonly rejection?: string;
    }) => (
      <form
        data-enabled={String(enabled)}
        data-referral-applied={String(referralApplied)}
        data-rejection={rejection}
      />
    ),
  })
);
mock.module("@/shared/components/route-auto-refresh", () => ({
  RouteAutoRefresh: ({ refreshAt }: { readonly refreshAt: string }) => (
    <meta data-refresh-at={refreshAt} />
  ),
}));

const { default: LocalizedCheckoutPayPage, generateMetadata } = await import(
  "./page"
);
const { discountCodeErrorQueryParam, payStateTokenQueryParam } = await import(
  "@/features/checkout/backend/checkout"
);
const { buildSignedPayState, sealPayState } = await import(
  "@/features/checkout/backend/checkout/pay-state"
);

/** Seals a genuine cowork Pay state for a stay on `date`. */
const sealCoworkPayState = ({
  date,
  locale = "cs-CZ",
  changedKeys,
}: {
  readonly date: string;
  readonly locale?: Locale;
  readonly changedKeys?: {
    readonly sectionKeys: readonly string[];
    readonly itemKeys: readonly string[];
  };
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reservation = Schema.decodeUnknownSync(
        normalizedCoworkReservationOrderSchema
      )({
        kind: "cowork",
        entryTier: "basic",
        date,
        coffee: false,
        name: "Ada Lovelace",
        email: testEmailAddress("ada"),
        phone: "+420777000111",
      });
      const quote = yield* buildCoworkReservationQuote({
        kind: "cowork",
        entryTier: reservation.entryTier,
        coffee: reservation.coffee,
      });
      const state = yield* buildSignedPayState({
        locale,
        reservation,
        quote,
        orderId: workspaceReservationIdSchema.make("reservation-id"),
        bookedAt: instantStringSchema.make("2026-06-01T09:58:00.000Z"),
        holdExpiresAt: instantStringSchema.make("2099-06-01T10:08:00.000Z"),
        checkoutSessionId: checkoutSessionIdSchema.make("session-id"),
      });
      return yield* sealPayState({
        ...state,
        ...(changedKeys && { changedKeys }),
      });
    }).pipe(Effect.provide(TestSealedStateKeys))
  );

const distantDate = "2099-06-20";
const tomorrow = () =>
  Temporal.Now.plainDateISO("Europe/Prague").add({ days: 1 }).toString();

async function renderPayPage(searchParams: SearchParamsRecord) {
  const { prelude } = await prerender(
    await LocalizedCheckoutPayPage({
      searchParams: Promise.resolve(searchParams),
    }),
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  return new Response(prelude).text();
}

/** The value of `attribute` on the first element that carries it. */
const attributeOf = (markup: string, attribute: string) =>
  new RegExp(`${attribute}="([^"]*)"`)
    .exec(markup)?.[1]
    ?.replaceAll("&amp;", "&");

/** Where the invalid-state card's restart button leads. */
const restartPathOf = (markup: string) =>
  /<a [^>]*href="([^"]*)"/.exec(markup)?.[1];

test("keeps the pay page out of search results without naming its URL", async () => {
  const metadata = await generateMetadata();

  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.alternates).toBeUndefined();
  expect(metadata.openGraph?.url).toBeUndefined();
});

describe("LocalizedCheckoutPayPage", () => {
  test("renders the held office list only for the Pay state's author", async () => {
    reservationPayable = true;
    const token = await officeCheckout.seal("cs-CZ");
    const query = { [payStateTokenQueryParam]: token };

    const authorMarkup = await renderPayPage(query);
    expect(attributeOf(authorMarkup, "data-variant")).toBe("pay");
    expect(attributeOf(authorMarkup, "data-booker-email")).toBe(
      officeCheckout.reservation.email
    );
    expect(attributeOf(authorMarkup, "data-booker-name")).toBe(
      officeCheckout.reservation.name
    );
    expect(attributeOf(authorMarkup, "data-invitee-email")).toBe(
      officeCheckout.inviteeEmail
    );

    officeCheckout.signInAsAnotherAccount();
    const otherMarkup = await renderPayPage(query);
    expect(otherMarkup).not.toContain(officeCheckout.inviteeEmail);
    expect(attributeOf(otherMarkup, "data-booker-email")).toBeUndefined();
  });

  test("lets a customer pay for a held reservation", async () => {
    reservationPayable = true;
    discountCodeEntryEnabled = true;
    const token = await sealCoworkPayState({ date: distantDate });
    const markup = await renderPayPage({ [payStateTokenQueryParam]: token });

    expect(attributeOf(markup, "data-variant")).toBe("pay");
    expect(attributeOf(markup, "data-pay-state-token")).toBe(token);
    expect(attributeOf(markup, "data-fresh-pay-url")).toBeUndefined();
    expect(attributeOf(markup, "data-enabled")).toBe("true");
    expect(attributeOf(markup, "data-referral-applied")).toBe("false");
    expect(attributeOf(markup, "data-early-performance")).toBe("false");
    expect(attributeOf(markup, "data-refresh-at")).toBeDefined();
    expect(attributeOf(markup, "data-choose-space")).toBe(
      getReservationStartPath(
        "cs-CZ",
        "cowork",
        new URLSearchParams({ [payStateTokenQueryParam]: token })
      )
    );
    expect(attributeOf(markup, "data-contact")).toBe(
      getReservationStartPath(
        "cs-CZ",
        "cowork",
        new URLSearchParams({
          [payStateTokenQueryParam]: token,
          [reservationCheckoutStepQueryParam]: "contact",
        })
      )
    );
  });

  test("asks for early performance on a stay inside the withdrawal period", async () => {
    reservationPayable = true;
    const token = await sealCoworkPayState({ date: tomorrow() });
    const markup = await renderPayPage({ [payStateTokenQueryParam]: token });

    expect(attributeOf(markup, "data-early-performance")).toBe("true");
    expect(attributeOf(markup, "data-refresh-at")).toBeUndefined();
  });

  test("shows a changed price with a fresh Pay link instead of payment", async () => {
    reservationPayable = true;
    const token = await sealCoworkPayState({
      date: distantDate,
      changedKeys: { sectionKeys: ["total"], itemKeys: [] },
    });
    const markup = await renderPayPage({ [payStateTokenQueryParam]: token });

    expect(attributeOf(markup, "data-variant")).toBe("pricingChanged");
    expect(attributeOf(markup, "data-pay-state-token")).toBeUndefined();
    expect(attributeOf(markup, "data-fresh-pay-url")).toContain(
      `${payStateTokenQueryParam}=`
    );
  });

  test("passes a rejected discount code back to a disabled form", async () => {
    reservationPayable = true;
    discountCodeEntryEnabled = false;
    const token = await sealCoworkPayState({ date: distantDate });
    const markup = await renderPayPage({
      [payStateTokenQueryParam]: token,
      [discountCodeErrorQueryParam]: "unavailable",
    });

    expect(attributeOf(markup, "data-enabled")).toBe("false");
    expect(attributeOf(markup, "data-rejection")).toBe("unavailable");
    discountCodeEntryEnabled = true;
  });

  test("restarts an order without a usable Pay state", async () => {
    reservationPayable = true;
    const otherLocaleToken = await sealCoworkPayState({
      date: distantDate,
      locale: "en-US",
    });

    const missing = await renderPayPage({});
    const unreadable = await renderPayPage({
      [payStateTokenQueryParam]: "not-a-pay-state",
    });
    const otherLocale = await renderPayPage({
      [payStateTokenQueryParam]: otherLocaleToken,
    });

    for (const markup of [missing, unreadable, otherLocale]) {
      expect(attributeOf(markup, "data-variant")).toBeUndefined();
    }
    expect(restartPathOf(missing)).toBe(getCoworkReservationPath("cs-CZ"));
    expect(restartPathOf(unreadable)).toBe(getCoworkReservationPath("cs-CZ"));
    expect(restartPathOf(otherLocale)).toBe(
      getReservationStartPath("cs-CZ", "cowork")
    );
  });

  test("restarts an order when its key ring can't be read", async () => {
    reservationPayable = true;
    const token = await sealCoworkPayState({ date: distantDate });
    keyRingMalformed = true;
    const markup = await renderPayPage({
      [payStateTokenQueryParam]: token,
    }).finally(() => {
      keyRingMalformed = false;
    });

    expect(attributeOf(markup, "data-variant")).toBeUndefined();
    expect(restartPathOf(markup)).toBe(getCoworkReservationPath("cs-CZ"));
  });

  test("restarts an order whose reservation is no longer held", async () => {
    reservationPayable = false;
    const token = await sealCoworkPayState({ date: distantDate });
    const markup = await renderPayPage({ [payStateTokenQueryParam]: token });

    expect(attributeOf(markup, "data-variant")).toBeUndefined();
    expect(restartPathOf(markup)).toBe(
      getReservationStartPath("cs-CZ", "cowork")
    );
    reservationPayable = true;
  });
});
