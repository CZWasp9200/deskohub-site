import { testEmailAddress } from "@deskohub/test-email";
import {
  type AccountPasskey,
  CustomerAccountId,
  type CustomerAccountState,
  type CustomerAgentConnection,
  type CustomerCompanyDetails,
  type CustomerEstablishment,
  type CustomerInvoice,
  CustomerInvoiceId,
  type CustomerMarketingPreferences,
  type CustomerOrderFulfillmentStatus,
  type CustomerOrderPaymentStatus,
  type CustomerOrderState,
  type CustomerOrderStatus,
  type CustomerProfile,
  type CustomerReservationAccess,
  type CustomerReservationHistory,
  CustomerReservationOrderId,
  type CustomerReservationSummary,
  type ReferralAccountOverview,
  ReferralCode,
} from "@deskohub/workspace-customer-api";

/**
 * Synthetic Workspace data for tests and the dev-only sample-data mode. Every
 * name, address, code and identifier here is made up; emails use the test
 * domain that never delivers mail. Screen clones extend these fixtures for
 * their own states.
 */

import type { SampleAccountKind } from "../sample-data-mode";

export type { SampleAccountKind };

export interface SampleOrder {
  readonly state: CustomerOrderState;
  readonly access?: CustomerReservationAccess;
  /** The issued invoice PDF; absent until issued. */
  readonly invoice?: Uint8Array;
}

/**
 * An issued invoice, its PDF and a cancelled one's credit note PDF; a PDF
 * the Workspace can't find is absent.
 */
export interface SampleInvoice {
  readonly invoice: CustomerInvoice;
  readonly pdf?: Uint8Array;
  readonly creditNotePdf?: Uint8Array;
}

export interface FakeWorkspaceData {
  readonly accountId: CustomerAccountId;
  readonly account: CustomerAccountState;
  readonly history: CustomerReservationHistory;
  readonly orders: ReadonlyMap<string, SampleOrder>;
  /** The account's issued invoices, newest issue first. */
  readonly invoices: ReadonlyArray<SampleInvoice>;
  readonly passkeys: ReadonlyArray<AccountPasskey>;
  readonly assistants: ReadonlyArray<CustomerAgentConnection>;
  readonly marketing: CustomerMarketingPreferences;
  readonly referrals: ReferralAccountOverview;
}

export const sampleAccountId = CustomerAccountId.make("sample-account-1");
export const sampleEmail = testEmailAddress("alex.sample");

export const sampleProfile: CustomerProfile = {
  firstName: "Alex",
  lastName: "Sample",
  phone: "+420 600 000 000",
  billing: {
    kind: "business",
    companyName: "Sample Studio s.r.o.",
    companyId: "00000000",
    vatId: "CZ00000000",
    addressLine1: "Example Street 1",
    addressLine2: null,
    city: "Sampletown",
    zip: "000 00",
    country: "CZ",
  },
};

/** The code a completion-required sample customer was invited with. */
export const sampleInvitationCode = ReferralCode.make("SAMPLE-FRIEND");

/**
 * Made-up companies the company lookup finds, by company ID: one with a VAT
 * ID and one without. Any other ID is not found, except
 * `sampleUnreachableCompanyId`.
 */
export const sampleCompanies: ReadonlyMap<string, CustomerCompanyDetails> =
  new Map([
    [
      "12345679",
      {
        companyName: "Ukázková firma s.r.o.",
        companyId: "12345679",
        vatId: "CZ12345679",
        addressLine1: "Ukázková 1",
        city: "Praha",
        zip: "10000",
        country: "CZ",
      },
    ],
    [
      "00000019",
      {
        companyName: "Vzorový spolek",
        companyId: "00000019",
        addressLine1: "Vzorová 2",
        city: "Brno",
        zip: "60200",
        country: "CZ",
      },
    ],
  ]);

/**
 * A made-up company ID the business registry never answers for, so the
 * lookup shows the registry unavailable.
 */
export const sampleUnreachableCompanyId = "00000027";

/** A made-up space the reservation screens can place and link to a map. */
export const sampleEstablishment: CustomerEstablishment = {
  name: "Sample Workspace",
  formattedAddress: "Ukázková 1, 100 00 Praha 10 - Vzorov",
  address: {
    street: "Ukázková 1",
    cityDistrict: "Vzorov",
    city: "Praha 10",
    postalCode: "100 00",
    country: "CZ",
  },
  coordinates: { lat: 50.0755, lng: 14.4378 },
  directionsUrl:
    "https://www.google.com/maps/dir/?api=1&destination=50.0755,14.4378",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=50.0755,14.4378",
};

export const sampleOrderIds = {
  fulfilled: CustomerReservationOrderId.make("sample-order-fulfilled"),
  pending: CustomerReservationOrderId.make("sample-order-pending"),
  awaitingFulfillment: CustomerReservationOrderId.make("sample-order-waiting"),
  past: CustomerReservationOrderId.make("sample-order-past"),
  cancelled: CustomerReservationOrderId.make("sample-order-cancelled"),
  // Status and access screen states; reachable by deep link
  // (deskohub://reservations/<id>), not listed in the history.
  upcoming: CustomerReservationOrderId.make("sample-order-upcoming"),
  workstation: CustomerReservationOrderId.make("sample-order-workstation"),
  accessUnavailable: CustomerReservationOrderId.make(
    "sample-order-access-unavailable"
  ),
  awaitingDelivery: CustomerReservationOrderId.make(
    "sample-order-awaiting-delivery"
  ),
  fulfillmentDelayed: CustomerReservationOrderId.make(
    "sample-order-fulfillment-delayed"
  ),
  paymentFailed: CustomerReservationOrderId.make("sample-order-payment-failed"),
  expired: CustomerReservationOrderId.make("sample-order-expired"),
  latePaymentReview: CustomerReservationOrderId.make(
    "sample-order-late-payment-review"
  ),
} as const;

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const at = (now: Date, offset: number) =>
  new Date(now.getTime() + offset).toISOString();

/** A small, valid one-page PDF that reads "Sample invoice". */
export const sampleInvoicePdf = (): Uint8Array =>
  new TextEncoder().encode(
    [
      "%PDF-1.4",
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
      "4 0 obj<</Length 44>>stream",
      "BT /F1 18 Tf 40 70 Td (Sample invoice) Tj ET",
      "endstream endobj",
      "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
      "trailer<</Root 1 0 R>>",
      "%%EOF",
      "",
    ].join("\n")
  );

/** The Prague midnight `days` days from `now`, as the booking boards show. */
const pragueDayStart = (now: Date, days: number): Date => {
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Prague",
  }).format(new Date(now.getTime() + days * day));
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // Prague is one or two hours ahead of UTC.
  const pragueHour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/Prague",
    }).format(utcMidnight)
  );
  return new Date(utcMidnight - pragueHour * hour);
};

/**
 * The statuses of the sample Open Space desk booked 16 days ahead, one order
 * each, so every state of the booking ticket opens by deep link
 * (deskohub://reservations/sample-desk-<status>).
 */
export const sampleDeskStatuses = [
  "created",
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_delivery_delayed",
  "fulfilled",
  "payment_failed",
  "expired",
  "cancelled",
  "late_payment_review",
  "late_payment_refund",
] as const satisfies ReadonlyArray<CustomerOrderStatus>;

export const sampleDeskOrderId = (
  status: (typeof sampleDeskStatuses)[number]
) => CustomerReservationOrderId.make(`sample-desk-${status}`);

const deskPayment = {
  created: ["not_started", "not_started"],
  pending: ["pending", "not_started"],
  payment_pending_delayed: ["pending", "not_started"],
  paid_waiting_fulfillment: ["paid", "processing"],
  paid_delivery_delayed: ["paid", "awaiting_delivery"],
  fulfilled: ["paid", "fulfilled"],
  payment_failed: ["failed", "not_started"],
  expired: ["expired", "not_started"],
  cancelled: ["cancelled", "not_started"],
  late_payment_review: ["paid", "not_started"],
  late_payment_refund: ["paid", "not_started"],
} as const satisfies Record<
  (typeof sampleDeskStatuses)[number],
  readonly [CustomerOrderPaymentStatus, CustomerOrderFulfillmentStatus]
>;

/** The desk's day: 00:00 to 17:00 in Prague, 16 days ahead. */
const deskDay = (now: Date) => {
  const start = pragueDayStart(now, 16);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 17 * hour).toISOString(),
  };
};

const sampleDeskOrders = (now: Date): ReadonlyArray<[string, SampleOrder]> => {
  const { startsAt, endsAt } = deskDay(now);
  return sampleDeskStatuses.map((status) => {
    const [paymentStatus, fulfillmentStatus] = deskPayment[status];
    const orderId = sampleDeskOrderId(status);
    const confirmed =
      status === "fulfilled" || status === "paid_delivery_delayed";
    return [
      orderId,
      {
        state: {
          orderId,
          kind: "cowork",
          status,
          paymentStatus,
          fulfillmentStatus,
          startsAt,
          endsAt,
          total: { value: 25880, exponent: 2, currency: "CZK" },
          bookedSelection: {
            selection: {
              family: "cowork",
              date: startsAt.slice(0, 10),
              tier: "open-space",
            },
          },
        },
        ...(confirmed
          ? {
              access: {
                code: "3804276",
                accessStartsAt: startsAt,
                accessEndsAt: endsAt,
              },
              invoice: sampleInvoicePdf(),
            }
          : {}),
      },
    ];
  });
};

/**
 * The failed meeting-room order as the history lists it: not booked, at its
 * booked time six days ahead.
 */
export const samplePaymentFailedReservation = (
  now: Date
): CustomerReservationSummary => ({
  id: "sample-reservation-payment-failed",
  orderId: sampleOrderIds.paymentFailed,
  product: { kind: "meeting-room" },
  startsAt: at(now, 6 * day),
  endsAt: at(now, 6 * day + 2 * hour),
  seats: 6,
  status: "cancelled",
});

/** The sample desk in the history, with the lock's window. */
export const sampleDeskReservation = (
  now: Date,
  status: CustomerReservationSummary["status"] = "confirmed"
): CustomerReservationSummary => {
  const { startsAt, endsAt } = deskDay(now);
  return {
    id: "sample-reservation-desk",
    orderId: sampleDeskOrderId(
      status === "confirmed" ? "fulfilled" : "pending"
    ),
    product: { kind: "cowork", tier: "open-space" },
    startsAt,
    endsAt,
    seats: 1,
    status,
    accessStartsAt: startsAt,
    accessEndsAt: endsAt,
    ...(status === "confirmed" && {
      withdrawal: {
        eligible: true,
        periodEndsAt: new Date(
          now.getTime() + 14 * 24 * 3600 * 1000
        ).toISOString(),
      },
    }),
  };
};

/** A paid meeting room two days after the desk, still withdrawable. */
export const sampleLaterMeetingRoom = (
  now: Date
): CustomerReservationSummary => {
  const { startsAt } = deskDay(now);
  const start = new Date(new Date(startsAt).getTime() + 2 * 24 * 3600 * 1000);
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600 * 1000);
  return {
    id: "sample-reservation-room-later",
    orderId: sampleOrderIds.upcoming,
    product: { kind: "meeting-room" },
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    seats: 6,
    status: "confirmed",
    withdrawal: {
      eligible: true,
      periodEndsAt: new Date(
        now.getTime() + 14 * 24 * 3600 * 1000
      ).toISOString(),
    },
  };
};

/**
 * A reserved desk for the whole of today with a nine-digit PIN, the longest
 * the lock issues: the access screen's full-day window and longest PIN.
 */
export const sampleWholeDayDesk = (
  now: Date
): {
  readonly reservation: CustomerReservationSummary;
  readonly order: SampleOrder;
} => {
  const startsAt = pragueDayStart(now, 0).toISOString();
  const endsAt = pragueDayStart(now, 1).toISOString();
  const orderId = CustomerReservationOrderId.make("sample-order-whole-day");
  return {
    reservation: {
      id: "sample-reservation-whole-day",
      orderId,
      product: { kind: "cowork", tier: "reserved-desk" },
      startsAt,
      endsAt,
      seats: 1,
      status: "confirmed",
      accessStartsAt: startsAt,
      accessEndsAt: endsAt,
    },
    order: {
      state: {
        orderId,
        kind: "cowork",
        status: "fulfilled",
        paymentStatus: "paid",
        fulfillmentStatus: "fulfilled",
        startsAt,
        endsAt,
      },
      access: {
        code: "380427615",
        accessStartsAt: startsAt,
        accessEndsAt: endsAt,
      },
    },
  };
};

const sampleHistory = (now: Date): CustomerReservationHistory => ({
  current: [
    {
      id: "sample-reservation-1",
      orderId: sampleOrderIds.fulfilled,
      product: { kind: "cowork", tier: "plus" },
      startsAt: at(now, -1 * hour),
      endsAt: at(now, 7 * hour),
      seats: 1,
      status: "confirmed",
    },
    {
      id: "sample-reservation-2",
      orderId: sampleOrderIds.pending,
      product: { kind: "meeting-room" },
      startsAt: at(now, 2 * day),
      endsAt: at(now, 2 * day + 2 * hour),
      setupStartsAt: at(now, 2 * day - 0.5 * hour),
      seats: 6,
      status: "pending",
      party: { kind: "booked-by", authorName: "Sam Example" },
    },
    {
      id: "sample-reservation-3",
      orderId: sampleOrderIds.awaitingFulfillment,
      product: { kind: "office" },
      startsAt: at(now, 5 * day),
      endsAt: at(now, 12 * day),
      seats: 3,
      status: "requires-attention",
    },
  ],
  past: [
    {
      id: "sample-reservation-4",
      orderId: sampleOrderIds.past,
      product: { kind: "cowork", tier: "basic" },
      startsAt: at(now, -10 * day),
      endsAt: at(now, -10 * day + 8 * hour),
      seats: 1,
      status: "confirmed",
      party: { kind: "booked-for", customerName: "Jordan Example" },
    },
    {
      id: "sample-reservation-5",
      orderId: sampleOrderIds.cancelled,
      product: { kind: "meeting-room" },
      startsAt: at(now, -20 * day),
      endsAt: at(now, -20 * day + 1 * hour),
      seats: 4,
      status: "cancelled",
    },
    // Booked outside the website (no order to open) and its seat count
    // couldn't be read.
    {
      id: "sample-reservation-7",
      product: { kind: "cowork", tier: "open-space" },
      startsAt: at(now, -30 * day),
      endsAt: at(now, -30 * day + 8 * hour),
      seats: null,
      status: "confirmed",
    },
  ],
  unavailable: [
    {
      id: "sample-reservation-6",
      product: { kind: "other" },
      startsAt: null,
      endsAt: null,
      seats: null,
      status: "confirmed",
    },
  ],
});

const sampleOrders = (now: Date): ReadonlyMap<string, SampleOrder> =>
  new Map<string, SampleOrder>([
    ...sampleDeskOrders(now),
    [
      sampleOrderIds.fulfilled,
      {
        state: {
          orderId: sampleOrderIds.fulfilled,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, -1 * hour),
          endsAt: at(now, 7 * hour),
          total: { value: 45000, exponent: 2, currency: "CZK" },
        },
        access: {
          code: "000000",
          accessStartsAt: at(now, -1.5 * hour),
          accessEndsAt: at(now, 7.5 * hour),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.pending,
      {
        state: {
          orderId: sampleOrderIds.pending,
          kind: "meeting-room",
          status: "pending",
          paymentStatus: "pending",
          fulfillmentStatus: "not_started",
          startsAt: at(now, 2 * day),
          endsAt: at(now, 2 * day + 2 * hour),
          setupStartsAt: at(now, 2 * day - 0.5 * hour),
          total: { value: 120000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    [
      sampleOrderIds.awaitingFulfillment,
      {
        state: {
          orderId: sampleOrderIds.awaitingFulfillment,
          kind: "office",
          status: "paid_waiting_fulfillment",
          paymentStatus: "paid",
          fulfillmentStatus: "processing",
          startsAt: at(now, 5 * day),
          endsAt: at(now, 12 * day),
          total: { value: 980000, exponent: 2, currency: "CZK" },
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.past,
      {
        state: {
          orderId: sampleOrderIds.past,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, -10 * day),
          endsAt: at(now, -10 * day + 8 * hour),
          total: { value: 30000, exponent: 2, currency: "CZK" },
        },
        access: {
          code: "111111",
          accessStartsAt: at(now, -10 * day - 0.5 * hour),
          accessEndsAt: at(now, -10 * day + 8.5 * hour),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.cancelled,
      {
        state: {
          orderId: sampleOrderIds.cancelled,
          kind: "meeting-room",
          status: "cancelled",
          paymentStatus: "cancelled",
          fulfillmentStatus: "not_started",
        },
      },
    ],
    [
      sampleOrderIds.upcoming,
      {
        state: {
          orderId: sampleOrderIds.upcoming,
          kind: "meeting-room",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, 3 * day),
          endsAt: at(now, 3 * day + 3 * hour),
          setupStartsAt: at(now, 3 * day - 0.5 * hour),
          total: { value: 180000, exponent: 2, currency: "CZK" },
        },
        access: {
          code: "222222",
          accessStartsAt: at(now, 3 * day - 0.5 * hour),
          accessEndsAt: at(now, 3 * day + 3.5 * hour),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.workstation,
      {
        state: {
          orderId: sampleOrderIds.workstation,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, 2 * day),
          endsAt: at(now, 3 * day),
          total: { value: 53000, exponent: 2, currency: "CZK" },
          bookedSelection: {
            selection: {
              family: "cowork",
              date: at(now, 2 * day).slice(0, 10),
              tier: "reserved-desk",
              monitorOption: "2x27-qhd",
            },
          },
        },
        access: {
          code: "333333",
          accessStartsAt: at(now, 2 * day),
          accessEndsAt: at(now, 3 * day),
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.accessUnavailable,
      {
        state: {
          orderId: sampleOrderIds.accessUnavailable,
          kind: "cowork",
          status: "fulfilled",
          paymentStatus: "paid",
          fulfillmentStatus: "fulfilled",
          startsAt: at(now, 1 * day),
          endsAt: at(now, 1 * day + 8 * hour),
          total: { value: 45000, exponent: 2, currency: "CZK" },
        },
        invoice: sampleInvoicePdf(),
      },
    ],
    [
      sampleOrderIds.awaitingDelivery,
      {
        state: {
          orderId: sampleOrderIds.awaitingDelivery,
          kind: "office",
          status: "paid_awaiting_delivery",
          paymentStatus: "paid",
          fulfillmentStatus: "awaiting_delivery",
          startsAt: at(now, 7 * day),
          endsAt: at(now, 14 * day),
          total: { value: 980000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    [
      sampleOrderIds.fulfillmentDelayed,
      {
        state: {
          orderId: sampleOrderIds.fulfillmentDelayed,
          kind: "cowork",
          status: "paid_fulfillment_delayed",
          paymentStatus: "paid",
          fulfillmentStatus: "processing",
          startsAt: at(now, 4 * day),
          endsAt: at(now, 4 * day + 8 * hour),
          total: { value: 45000, exponent: 2, currency: "CZK" },
        },
      },
    ],
    // As the server answers a failed payment: no times or total, which only
    // a usable payment attempt gives; its list entry keeps the booked time.
    [
      sampleOrderIds.paymentFailed,
      {
        state: {
          orderId: sampleOrderIds.paymentFailed,
          kind: "meeting-room",
          status: "payment_failed",
          paymentStatus: "failed",
          fulfillmentStatus: "not_started",
        },
      },
    ],
    [
      sampleOrderIds.expired,
      {
        state: {
          orderId: sampleOrderIds.expired,
          kind: "cowork",
          status: "expired",
          paymentStatus: "expired",
          fulfillmentStatus: "not_started",
        },
      },
    ],
    [
      sampleOrderIds.latePaymentReview,
      {
        state: {
          orderId: sampleOrderIds.latePaymentReview,
          kind: "meeting-room",
          status: "late_payment_review",
          paymentStatus: "paid",
          fulfillmentStatus: "not_started",
          startsAt: at(now, 2 * day),
          endsAt: at(now, 2 * day + 2 * hour),
          total: { value: 120000, exponent: 2, currency: "CZK" },
        },
      },
    ],
  ]);

const samplePasskeys = (now: Date): ReadonlyArray<AccountPasskey> => [
  {
    id: "sample-passkey-1",
    name: "Sample phone",
    provider: "Google Password Manager",
    createdAt: at(now, -30 * day),
  },
  { id: "sample-passkey-2", createdAt: at(now, -3 * day) },
];

const sampleAssistants = (
  now: Date
): ReadonlyArray<CustomerAgentConnection> => [
  {
    id: "sample-consent-1",
    name: "Sample Assistant",
    host: "assistant.example.com",
    scopes: ["reservations:read", "booking:write"],
    administration: false,
    connectedAt: at(now, -7 * day),
  },
  {
    id: "sample-consent-2",
    host: "agent.example.org",
    scopes: ["reservations:read"],
    administration: true,
    connectedAt: at(now, -1 * day),
  },
];

const sampleReferrals: ReferralAccountOverview = {
  summary: {
    code: ReferralCode.make("SAMPLE-ALEX"),
    inviteeCount: 3,
    eligibleInviteeCount: 2,
    discount: "9.75",
    savings: [{ value: 15000, exponent: 2, currency: "CZK" }],
  },
  shareUrl: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
  discountPerInvitee: "5",
  invitationDiscount: "15",
  savingsCurrency: "CZK",
};

const sampleAccount = (
  kind: SampleAccountKind,
  now: Date
): CustomerAccountState => {
  const sessionSettings = {
    email: sampleEmail,
    passkeys: {
      accountId: sampleAccountId,
      passkeys: [...samplePasskeys(now)],
    },
    assistants: [...sampleAssistants(now)],
    // No saved language: the app follows the device language.
    locale: null,
  };
  switch (kind) {
    case "linked":
      return {
        kind,
        ...sessionSettings,
        deletion: "offered",
        profile: sampleProfile,
        avatar: { kind: "available", avatar: null },
        referralsEnabled: true,
        referrals: sampleReferrals,
      };
    case "completion-required":
      return {
        kind,
        ...sessionSettings,
        deletion: "offered",
        referralsEnabled: true,
        referralCode: sampleInvitationCode,
      };
    case "support-required":
    case "authenticated-unavailable":
      return { kind, ...sessionSettings, deletion: "offered" };
    case "review-account":
      return { kind, ...sessionSettings, deletion: "withheld" };
    case "deletion-pending":
      return {
        kind,
        email: sampleEmail,
        passkeys: sessionSettings.passkeys,
        locale: sessionSettings.locale,
        deletion: "pending",
      };
  }
};

// A review account's history and holds are review-sandbox samples.
const asReviewSandbox = (
  history: CustomerReservationHistory,
  orders: ReadonlyMap<string, SampleOrder>
) => ({
  history: {
    current: history.current.map((row) => ({
      ...row,
      reviewSandbox: true as const,
    })),
    past: history.past.map((row) => ({ ...row, reviewSandbox: true as const })),
    unavailable: history.unavailable,
  },
  orders: new Map(
    [...orders].map(([orderId, order]) => [
      orderId,
      { ...order, state: { ...order.state, reviewSandbox: true as const } },
    ])
  ),
});

export const sampleInvoiceIds = {
  desk: CustomerInvoiceId.make("sample-invoice-desk"),
  meetingRoom: CustomerInvoiceId.make("sample-invoice-meeting-room"),
  /** Cancelled by a credit note; both PDFs download. */
  cancelled: CustomerInvoiceId.make("sample-invoice-cancelled"),
  /** Listed, but its PDF can't be found: the download fails. */
  office: CustomerInvoiceId.make("sample-invoice-office"),
} as const;

/** The issued invoices of the linked sample account, newest first. */
export const sampleInvoices = (): ReadonlyArray<SampleInvoice> => [
  {
    invoice: {
      id: sampleInvoiceIds.desk,
      invoiceNumber: "2026-0412",
      issuedOn: "2026-11-26",
      total: { amount: "258.80", currency: "CZK" },
      orderId: sampleOrderIds.fulfilled,
      // One whole Prague day.
      reservation: {
        productName: "Open Space desk",
        startsAt: "2026-11-25T23:00:00.000Z",
        endsAt: "2026-11-26T23:00:00.000Z",
      },
    },
    pdf: sampleInvoicePdf(),
  },
  {
    invoice: {
      id: sampleInvoiceIds.meetingRoom,
      invoiceNumber: "2026-0377",
      issuedOn: "2026-11-02",
      total: { amount: "280", currency: "CZK" },
      orderId: sampleOrderIds.past,
      reservation: {
        productName: "Meeting room",
        startsAt: "2026-11-02T09:00:00.000Z",
        endsAt: "2026-11-02T11:00:00.000Z",
      },
    },
    pdf: sampleInvoicePdf(),
  },
  {
    invoice: {
      id: sampleInvoiceIds.cancelled,
      invoiceNumber: "2026-0359",
      issuedOn: "2026-10-27",
      total: { amount: "258.80", currency: "CZK" },
      cancellation: {
        correctiveDocumentNumber: "WS-OD-2026-000004",
        correctiveDocumentDownloadable: true,
      },
      // One whole Prague day.
      reservation: {
        productName: "Open Space desk",
        startsAt: "2026-10-26T23:00:00.000Z",
        endsAt: "2026-10-27T23:00:00.000Z",
      },
    },
    pdf: sampleInvoicePdf(),
    creditNotePdf: sampleInvoicePdf(),
  },
  {
    invoice: {
      id: sampleInvoiceIds.office,
      invoiceNumber: "2026-0341",
      issuedOn: "2026-10-15",
      total: { amount: "7260", currency: "CZK" },
    },
  },
];

/** A complete synthetic Workspace for one account in the given state. */
export const sampleWorkspaceData = (
  kind: SampleAccountKind,
  now: Date = new Date()
): FakeWorkspaceData => ({
  accountId: sampleAccountId,
  account: sampleAccount(kind, now),
  ...(kind === "review-account"
    ? asReviewSandbox(sampleHistory(now), sampleOrders(now))
    : { history: sampleHistory(now), orders: sampleOrders(now) }),
  invoices: kind === "linked" ? sampleInvoices() : [],
  passkeys: samplePasskeys(now),
  assistants: sampleAssistants(now),
  marketing: { status: "active", context: "sample-marketing-context-1" },
  referrals: sampleReferrals,
});
