import type { ReactNode } from "react";

type CheckoutStatusSummaryRow = {
  readonly label: string;
  /** Plain text, or a richer value such as the people coming to an office. */
  readonly value: ReactNode;
};

export type CheckoutStatusSummaryPresentation = {
  readonly reservationTitle: string;
  readonly rows: readonly CheckoutStatusSummaryRow[];
};
