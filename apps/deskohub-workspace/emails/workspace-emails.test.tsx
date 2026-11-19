import { describe, expect, test } from "bun:test";
import { render } from "react-email";
import { type Locale, locales } from "@/features/i18n";
import { formatReservationDisplayDateTimeRange } from "@/features/reservation/reservation-date";
import { staffLocale } from "@/shared/backend/staff-locale";
import { reservationEmailDetails } from "./_components/reservation-email-details";
import {
  contactBusinessPreviewProps,
  contactConfirmationPreviewProps,
  customerReservationPreviewProps,
  invoiceCancellationNoticePreviewProps,
  invoiceDeliveryPreviewProps,
  reservationAuthorPreviewProps,
  reservationCancellationPreviewProps,
  reservationNotificationPreviewProps,
  reservationRestorationPreviewProps,
  workspaceCampaignPreviewProps,
} from "./_fixtures/preview-props";
import { ContactBusinessEmail } from "./contact-business";
import { ContactConfirmationEmail } from "./contact-confirmation";
import { CustomerReservationEmail } from "./customer-reservation";
import {
  InvoiceCancellationNoticeEmail,
  type InvoiceCancellationNoticeEmailProps,
} from "./invoice-cancellation-notice";
import {
  InvoiceDeliveryEmail,
  type InvoiceDeliveryEmailProps,
} from "./invoice-delivery";
import { ReservationAuthorEmail } from "./reservation-author";
import { ReservationCancellationEmail } from "./reservation-cancellation";
import { ReservationNotificationEmail } from "./reservation-notification";
import {
  ReservationRestorationEmail,
  reservationRestorationEmailSubject,
} from "./reservation-restoration";
import { WorkspaceCampaignEmail } from "./workspace-campaign";

describe("Workspace React Email templates", () => {
  test("renders every template preview", async () => {
    const [
      business,
      confirmation,
      customerReservation,
      staffNotification,
      cancellation,
      invoiceDelivery,
      invoiceCancellationNotice,
      campaign,
    ] = await Promise.all([
      render(<ContactBusinessEmail {...contactBusinessPreviewProps} />),
      render(<ContactConfirmationEmail {...contactConfirmationPreviewProps} />),
      render(<CustomerReservationEmail {...customerReservationPreviewProps} />),
      render(
        <ReservationNotificationEmail
          {...reservationNotificationPreviewProps}
        />
      ),
      render(
        <ReservationCancellationEmail
          {...reservationCancellationPreviewProps}
        />
      ),
      render(<InvoiceDeliveryEmail {...invoiceDeliveryPreviewProps} />),
      render(
        <InvoiceCancellationNoticeEmail
          {...invoiceCancellationNoticePreviewProps}
        />
      ),
      render(<WorkspaceCampaignEmail {...workspaceCampaignPreviewProps} />),
    ]);

    expect(business).toContain(contactBusinessPreviewProps.name);
    expect(confirmation).toContain('lang="en-US"');
    expect(customerReservation).toContain(
      `href="${customerReservationPreviewProps.accessUrl}"`
    );
    expect(staffNotification).toContain(
      reservationNotificationPreviewProps.customer.email
    );
    expect(cancellation).toContain(
      reservationCancellationPreviewProps.reservation.id
    );
    expect(invoiceDelivery).toContain(
      invoiceDeliveryPreviewProps.invoiceNumber
    );
    expect(invoiceCancellationNotice).toContain(
      invoiceCancellationNoticePreviewProps.documentNumber
    );
    expect(campaign).toContain("Podzim ve Workspace");
    expect(campaign).toContain(
      `href="${workspaceCampaignPreviewProps.footer.marketingPreferencesUrl}"`
    );
  });

  test("renders the author confirmation with only its status link", async () => {
    const html = await render(
      <ReservationAuthorEmail {...reservationAuthorPreviewProps} />
    );

    expect(html).toContain(`href="${reservationAuthorPreviewProps.statusUrl}"`);
    expect(html).toContain(
      reservationAuthorPreviewProps.reservation.placement.table.name
    );
    expect(html).not.toContain("accessToken");
    expect(html).not.toContain(
      customerReservationPreviewProps.network.password
    );
  });
});

const czechThenEnglish = ["cs-CZ", "en-US"] as const satisfies Locale[];

describe("contact emails", () => {
  test("write the staff notification in the staff locale", async () => {
    const html = await render(
      <ContactBusinessEmail {...contactBusinessPreviewProps} />
    );

    expect(html).toContain(`lang="${staffLocale}"`);
    expect(html).toContain(contactBusinessPreviewProps.email);
  });

  test("list the phone only when the visitor gave one", async () => {
    const { phone, ...withoutPhone } = contactBusinessPreviewProps;
    const [withPhoneText, withoutPhoneText] = await Promise.all([
      render(<ContactBusinessEmail {...contactBusinessPreviewProps} />, {
        plainText: true,
      }),
      render(<ContactBusinessEmail {...withoutPhone} />, { plainText: true }),
    ]);

    expect(withPhoneText).toContain(phone);
    expect(withoutPhoneText).not.toContain(phone);
  });

  test("quote the visitor's message line by line in their locale", async () => {
    const message = "First line\nSecond line";
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(<ContactConfirmationEmail locale={locale} message={message} />)
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
    expect(english).toContain("First line<br/>Second line");
  });
});

describe("invoice delivery email", () => {
  const manualInvoice = (requestsPayment: boolean) =>
    ({
      ...invoiceDeliveryPreviewProps,
      invoice: { source: "manual", requestsPayment },
    }) satisfies InvoiceDeliveryEmailProps;

  test("writes the customer copy in the invoice's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <InvoiceDeliveryEmail
            {...invoiceDeliveryPreviewProps}
            recipient={{ audience: "customer", locale }}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("writes the staff copy in the staff locale", async () => {
    const html = await render(
      <InvoiceDeliveryEmail
        {...invoiceDeliveryPreviewProps}
        recipient={{ audience: "internal" }}
      />
    );

    expect(html).toContain(`lang="${staffLocale}"`);
    expect(html).toContain(invoiceDeliveryPreviewProps.invoiceNumber);
  });

  test("asks a manual invoice's customer for payment only when it is due", async () => {
    const [requested, settled] = await Promise.all([
      render(<InvoiceDeliveryEmail {...manualInvoice(true)} />, {
        plainText: true,
      }),
      render(<InvoiceDeliveryEmail {...manualInvoice(false)} />, {
        plainText: true,
      }),
    ]);

    expect(requested).not.toBe(settled);
  });

  test("names the order of a reservation invoice", async () => {
    const html = await render(
      <InvoiceDeliveryEmail {...invoiceDeliveryPreviewProps} />
    );

    expect(html).toContain(invoiceDeliveryPreviewProps.invoice.orderId);
  });
});

describe("invoice cancellation notice email", () => {
  const notice = (
    overrides: Partial<InvoiceCancellationNoticeEmailProps> = {}
  ): InvoiceCancellationNoticeEmailProps => ({
    ...invoiceCancellationNoticePreviewProps,
    ...overrides,
  });
  const nothingDue = {
    settlement: "nothing_due",
    total: "-450.00",
    currency: "CZK",
  } as const;

  test("writes the customer copy in the document's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <InvoiceCancellationNoticeEmail
            {...notice({ recipient: { audience: "customer", locale } })}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("writes the staff copy in the staff locale", async () => {
    const html = await render(
      <InvoiceCancellationNoticeEmail
        {...notice({ recipient: { audience: "internal" } })}
      />
    );

    expect(html).toContain(`lang="${staffLocale}"`);
  });

  test("names the cancelled invoice and its corrective document for every audience and source", async () => {
    const variants = [
      notice(),
      notice({ invoice: { source: "manual" } }),
      notice({ recipient: { audience: "internal" } }),
      notice({
        invoice: { source: "manual" },
        recipient: { audience: "internal" },
      }),
    ];
    const rendered = await Promise.all(
      variants.map((props) =>
        render(<InvoiceCancellationNoticeEmail {...props} />, {
          plainText: true,
        })
      )
    );

    for (const text of rendered) {
      expect(text).toContain(
        invoiceCancellationNoticePreviewProps.invoiceNumber
      );
      expect(text).toContain(
        invoiceCancellationNoticePreviewProps.documentNumber
      );
    }
    expect(new Set(rendered).size).toBe(variants.length);
  });

  test("names the order of a reservation invoice", async () => {
    const html = await render(<InvoiceCancellationNoticeEmail {...notice()} />);

    expect(html).toContain(
      invoiceCancellationNoticePreviewProps.invoice.orderId
    );
  });

  test("tells the customer whether money comes back, and never staff", async () => {
    const [refund, settled, staffRefund, staffSettled] = await Promise.all(
      [
        notice(),
        notice({ settlement: nothingDue }),
        notice({ recipient: { audience: "internal" } }),
        notice({ settlement: nothingDue, recipient: { audience: "internal" } }),
      ].map((props) =>
        render(<InvoiceCancellationNoticeEmail {...props} />, {
          plainText: true,
        })
      )
    );

    expect(refund).not.toBe(settled);
    expect(staffRefund).toBe(staffSettled);
  });
});

describe("reservation emails", () => {
  test("write the customer confirmation in the customer's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <CustomerReservationEmail
            {...customerReservationPreviewProps}
            locale={locale}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("head an overnight stay's confirmation with its start and end", async () => {
    const overnight = {
      ...customerReservationPreviewProps.reservation,
      reservationDetails: {
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: false,
      },
      reservedFrom: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-13T10:00:00Z"),
    } as const;
    const stay = formatReservationDisplayDateTimeRange(
      overnight.reservedFrom,
      overnight.reservedUntil,
      "en-US"
    );
    const [overnightEmail, dayEmail] = await Promise.all([
      render(
        <CustomerReservationEmail
          {...customerReservationPreviewProps}
          reservation={overnight}
        />
      ),
      render(<CustomerReservationEmail {...customerReservationPreviewProps} />),
    ]);

    expect(overnightEmail).toContain(stay);
    expect(dayEmail).not.toContain(stay);
  });

  test("link the customer confirmation to its access page and invoice", async () => {
    const html = await render(
      <CustomerReservationEmail {...customerReservationPreviewProps} />
    );

    expect(html).toContain(
      `href="${customerReservationPreviewProps.accessUrl}"`
    );
    expect(html).toContain(
      `href="${customerReservationPreviewProps.invoiceUrl}"`
    );
  });

  test("show the Wi-Fi and its QR code only when the customer gets them", async () => {
    const { network, ...withoutNetwork } = customerReservationPreviewProps;
    const [withNetwork, withoutNetworkHtml] = await Promise.all([
      render(<CustomerReservationEmail {...customerReservationPreviewProps} />),
      render(<CustomerReservationEmail {...withoutNetwork} />),
    ]);

    const qrImageSrc = network.qrImageSrc.replaceAll("&", "&amp;");

    expect(withNetwork).toContain(network.password);
    expect(withNetwork).toContain(`src="${qrImageSrc}"`);
    expect(withoutNetworkHtml).not.toContain(network.password);
    expect(withoutNetworkHtml).not.toContain(qrImageSrc);
  });

  test("show the table only when the reservation has one", async () => {
    const { reservation } = customerReservationPreviewProps;
    const [assigned, unplaced] = await Promise.all([
      render(
        <CustomerReservationEmail {...customerReservationPreviewProps} />,
        {
          plainText: true,
        }
      ),
      render(
        <CustomerReservationEmail
          {...customerReservationPreviewProps}
          reservation={{ ...reservation, placement: {} }}
        />,
        { plainText: true }
      ),
    ]);

    expect(assigned).not.toBe(unplaced);
    expect(assigned).toContain(reservation.placement.table.name);
  });

  test("write the author confirmation in the author's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <ReservationAuthorEmail
            {...reservationAuthorPreviewProps}
            locale={locale}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("write the staff notification in the staff locale", async () => {
    const html = await render(
      <ReservationNotificationEmail {...reservationNotificationPreviewProps} />
    );

    expect(html).toContain(`lang="${staffLocale}"`);
    expect(html).toContain(reservationNotificationPreviewProps.reservation.id);
  });

  test("list the customer's phone only when they gave one", async () => {
    const { customer } = reservationNotificationPreviewProps;
    const [withPhone, withoutPhone] = await Promise.all([
      render(
        <ReservationNotificationEmail
          {...reservationNotificationPreviewProps}
        />,
        { plainText: true }
      ),
      render(
        <ReservationNotificationEmail
          {...reservationNotificationPreviewProps}
          customer={{ ...customer, phone: " " }}
        />,
        { plainText: true }
      ),
    ]);

    expect(withPhone).toContain(customer.phone);
    expect(withoutPhone).not.toContain(customer.phone);
  });

  test("write the cancellation in the customer's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <ReservationCancellationEmail
            {...reservationCancellationPreviewProps}
            locale={locale}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });
});

describe("reservation restoration email", () => {
  const englishSubject = reservationRestorationEmailSubject({
    locale: "en-US",
  });

  test.each(locales)(
    "renders in %s with the booking details and the access link",
    async (locale) => {
      const props = { ...reservationRestorationPreviewProps, locale };
      const [html, text] = await Promise.all([
        render(<ReservationRestorationEmail {...props} />),
        render(<ReservationRestorationEmail {...props} />, { plainText: true }),
      ]);

      expect(html).toContain(`lang="${locale}"`);
      const subject = reservationRestorationEmailSubject(props);
      expect(subject).not.toBe("");
      // Every catalog carries its own subject instead of the base fallback.
      if (locale !== "en-US") expect(subject).not.toBe(englishSubject);
      for (const { value } of reservationEmailDetails(
        props.reservation,
        locale
      )) {
        expect(text).toContain(value);
      }
      expect(html).toContain(`href="${props.accessUrl}"`);
    }
  );

  test("links no access page when the restoration issued no new access code", async () => {
    const { accessUrl, ...props } = reservationRestorationPreviewProps;
    const [withAccess, withoutAccess] = await Promise.all([
      render(<ReservationRestorationEmail {...props} accessUrl={accessUrl} />),
      render(<ReservationRestorationEmail {...props} />),
    ]);

    expect(withAccess).toContain("/reservation/access/");
    expect(withoutAccess).not.toContain("/reservation/access/");
    expect(withoutAccess).not.toContain("accessToken=");
    expect(withoutAccess).toContain(props.reservation.id);
  });
});
