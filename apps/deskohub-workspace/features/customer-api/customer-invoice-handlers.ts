import "server-only";

import {
  type CustomerInvoice,
  CustomerInvoiceNotFound,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  type CustomerInvoiceListing,
  CustomerInvoiceService,
} from "@/features/account/backend/customer-invoice.service";
import { defaultLocale } from "@/features/i18n";
import { CustomerAccountLayers } from "./customer-account-layers";
import { answerCustomerApiFailure } from "./customer-api-failure";
import { answerFileDownload } from "./customer-file-download";

/**
 * The invoices group's handlers, over the account's `CustomerInvoiceService`
 * as the account page uses it, read under the request's own account
 * standing. The service authorizes every call and reads only the account's
 * own customer's invoices; an invoice it can't find, someone else's
 * included, is not found. A refused account answers as the account
 * endpoints do.
 */
export const CustomerInvoicesApiHandlers = HttpApiBuilder.group(
  WorkspaceCustomerApi,
  "invoices",
  Effect.fn(function* (handlers) {
    const { services } = yield* CustomerAccountLayers;
    // The authentication the session middleware read the request through.
    const authentication = Layer.succeed(
      CustomerAuthentication,
      yield* CustomerAuthentication
    );
    const invoices = services.invoices.pipe(
      Layer.provide(services.currentAccount),
      Layer.provide(authentication)
    );

    return handlers
      .handle("listInvoices", ({ query: { locale = defaultLocale } }) =>
        Effect.flatMap(CustomerInvoiceService, (service) =>
          service.list({ locale })
        ).pipe(
          Effect.provide(invoices),
          Effect.catchTag("CustomerInvoicesUnavailableError", ({ account }) =>
            Effect.fail(account)
          ),
          answerCustomerApiFailure("customerApi.listInvoices"),
          Effect.map((summaries) => ({
            invoices: summaries.map(answerInvoice),
          }))
        )
      )
      .handle("getInvoicePdf", ({ params: { invoiceId } }) =>
        Effect.flatMap(CustomerInvoiceService, (service) =>
          service.pdf(invoiceId)
        ).pipe(
          Effect.provide(invoices),
          Effect.catchTags(
            {
              CustomerInvoiceNotFoundError: () =>
                Effect.fail(new CustomerInvoiceNotFound()),
              CustomerInvoicesUnavailableError: ({ account }) =>
                answerCustomerApiFailure("customerApi.getInvoicePdf")(
                  Effect.fail(account)
                ),
            },
            (failure) =>
              answerCustomerApiFailure("customerApi.getInvoicePdf")(
                Effect.fail(failure)
              )
          ),
          Effect.map(answerFileDownload("application/pdf"))
        )
      );
  })
);

/** An invoice as the contract carries it, without unknown fields. */
const answerInvoice = ({
  id,
  invoiceNumber,
  workspaceReservationId,
  issuedOn,
  total: { amount, currency },
  reservation,
}: CustomerInvoiceListing): CustomerInvoice => ({
  id,
  invoiceNumber,
  issuedOn,
  total: { amount, currency },
  ...(workspaceReservationId && { orderId: workspaceReservationId }),
  ...(reservation && {
    reservation: {
      productName: reservation.productName,
      ...(reservation.seats !== null && { seats: reservation.seats }),
      startsAt: reservation.startsAt,
      endsAt: reservation.endsAt,
    },
  }),
});
