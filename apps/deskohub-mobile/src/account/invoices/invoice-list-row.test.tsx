import { describe, expect, test } from "bun:test";
import type { CustomerInvoice } from "@deskohub/workspace-customer-api";
import type { ReactElement } from "react";
import { sampleInvoices } from "../../customer-api/testing/sample-fixtures";
import { Badge } from "../../ui/badge";
import { Button, ButtonRow } from "../../ui/controls";
import { ListRow } from "../../ui/list";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { findAll } from "../../ui/testing/element-tree";
import { Text } from "../../ui/text";
import {
  InvoiceDownload,
  invoiceRowOf,
  invoiceRowText,
} from "./invoice-list-model";
import { InvoiceListRow } from "./invoice-list-row";

const creditNoteNumber = "WS-OD-2026-000004";
// Every sample invoice in force, described or plain.
const inForce = sampleInvoices()
  .map(({ invoice }) => invoice)
  .filter((invoice) => invoice.cancellation === undefined);
const cancelled = (
  invoice: CustomerInvoice,
  correctiveDocumentDownloadable = true
): CustomerInvoice => ({
  ...invoice,
  cancellation: {
    correctiveDocumentNumber: creditNoteNumber,
    ...(correctiveDocumentDownloadable && {
      correctiveDocumentDownloadable,
    }),
  },
});

const element = (
  invoice: CustomerInvoice,
  {
    downloading,
    held = false,
    amountColumn = false,
    onDownload = () => undefined,
  }: {
    readonly downloading?: InvoiceDownload["_tag"];
    readonly held?: boolean;
    readonly amountColumn?: boolean;
    readonly onDownload?: (download: InvoiceDownload) => void;
  } = {}
) =>
  InvoiceListRow({
    row: invoiceRowOf(invoice),
    locale: "en-US",
    downloading,
    held,
    amountColumn,
    onDownload,
  });

/** The invoice and credit note buttons under a cancelled row. */
const downloadButtons = (row: ReactElement<{ below?: ReactElement }>) => {
  const buttonRow = (
    row.props.below as ReactElement<{ children: ReactElement }> | undefined
  )?.props.children as
    | ReactElement<{ children: ReadonlyArray<ReactElement> }>
    | undefined;
  expect(buttonRow?.type).toBe(ButtonRow);
  const [invoice, creditNote] = (buttonRow?.props.children ??
    []) as ReadonlyArray<
    ReactElement<{
      busy: boolean;
      disabled: boolean;
      accessibilityLabel: string;
      onPress: () => void;
    }>
  >;
  if (invoice === undefined || creditNote === undefined)
    throw new Error("a cancelled row has two download buttons");
  expect(invoice.type).toBe(Button);
  expect(creditNote.type).toBe(Button);
  return { invoice, creditNote };
};

describe("InvoiceListRow", () => {
  test.each([false, true])(
    "a cancelled invoice offers both downloads with amountColumn=%s",
    (amountColumn) => {
      for (const invoice of inForce) {
        const requested: InvoiceDownload[] = [];
        const row = element(cancelled(invoice), {
          amountColumn,
          onDownload: (download) => requested.push(download),
        });

        expect(row.type).toBe(ListRow);
        expect(row.props.badge.type).toBe(Badge);
        expect(row.props.badge.props.tone).toBe("neutral");
        // Its buttons act; the row itself doesn't.
        expect(row.props.onPress).toBeUndefined();
        const buttons = downloadButtons(row);
        expect(buttons.invoice.props.accessibilityLabel).toContain(
          invoice.invoiceNumber
        );
        expect(buttons.creditNote.props.accessibilityLabel).toContain(
          creditNoteNumber
        );

        buttons.invoice.props.onPress();
        buttons.creditNote.props.onPress();

        expect(requested).toEqual([
          InvoiceDownload.Invoice({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          }),
          InvoiceDownload.CreditNote({
            id: invoice.id,
            correctiveDocumentNumber: creditNoteNumber,
          }),
        ]);
      }
    }
  );

  test("wide rows put the total and a non-redundant invoice number in the trailing column", () => {
    for (const invoice of inForce) {
      const model = invoiceRowOf(invoice);
      const details = invoiceRowText(model, "en-US");
      const row = element(invoice, { amountColumn: true });
      const compact = element(invoice);
      const columnText = findAll(row.props.trailing, Text).map(
        ({ props }) => props.children
      );

      expect(row.props.description).toBe(details.when);
      expect(row.props.accessibilityLabel).toBe(
        compact.props.accessibilityLabel
      );
      expect(compact.props.description).toContain(details.amount);
      expect(columnText).toEqual(
        model._tag === "Described"
          ? [details.amount, `No. ${invoice.invoiceNumber}`]
          : [details.amount]
      );
    }
  });

  test("an invoice in force is one download with no cancelled mark and no credit note", () => {
    for (const invoice of inForce) {
      const requested: InvoiceDownload[] = [];
      const row = element(invoice, {
        onDownload: (download) => requested.push(download),
      });

      expect(row.type).toBe(ListRow);
      expect(row.props.badge).toBeUndefined();
      expect(row.props.below).toBeUndefined();

      row.props.onPress();

      expect(requested).toEqual([
        InvoiceDownload.Invoice({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        }),
      ]);
    }
  });

  test("a cancellation whose credit note the Workspace doesn't serve keeps the mark and one download", () => {
    const [invoice] = inForce;
    if (invoice === undefined) throw new Error("the sample has invoices");

    const row = element(cancelled(invoice, false));

    expect(row.props.badge.type).toBe(Badge);
    expect(row.props.accessibilityLabel).toContain(row.props.badge.props.label);
    expect(row.props.below).toBeUndefined();
    expect(row.props.onPress).toBeFunction();
  });

  test("while the credit note downloads, its button is busy and the invoice's held", () => {
    const [invoice] = inForce;
    if (invoice === undefined) throw new Error("the sample has invoices");

    const idle = downloadButtons(element(cancelled(invoice)));
    const { invoice: invoiceButton, creditNote } = downloadButtons(
      element(cancelled(invoice), { downloading: "CreditNote", held: true })
    );

    expect(creditNote.props.busy).toBe(true);
    expect(creditNote.props.disabled).toBe(false);
    expect(creditNote.props.accessibilityLabel).not.toBe(
      idle.creditNote.props.accessibilityLabel
    );
    expect(creditNote.props.accessibilityLabel).toContain(creditNoteNumber);
    expect(invoiceButton.props.busy).toBe(false);
    expect(invoiceButton.props.disabled).toBe(true);
  });

  test("another row's download holds both buttons", () => {
    const [invoice] = inForce;
    if (invoice === undefined) throw new Error("the sample has invoices");

    const buttons = downloadButtons(
      element(cancelled(invoice), { held: true })
    );

    for (const button of [buttons.invoice, buttons.creditNote]) {
      expect(button.props.busy).toBe(false);
      expect(button.props.disabled).toBe(true);
    }
  });

  test("an invoice in force shows its download in progress in place of its action", () => {
    const [invoice] = inForce;
    if (invoice === undefined) throw new Error("the sample has invoices");

    const row = element(invoice, { downloading: "Invoice", held: true });

    expect(row.props.trailing.type).toBe(LoadingIndicator);
    expect(row.props.disabled).toBe(true);
  });
});
