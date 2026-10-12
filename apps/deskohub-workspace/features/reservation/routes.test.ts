import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  coworkReservationPath,
  getReservationStartPath,
  meetingRoomReservationPath,
  officeReservationPath,
  reservationAccessPath,
  reservationInvoicePath,
  reservationStatusPath,
} from "./routes";

const appRouteExists = (path: string) =>
  existsSync(
    fileURLToPath(
      new URL(`../../app/[locale]/(minimal-header)${path}`, import.meta.url)
    )
  );

describe("reservation routes", () => {
  test("joins search params onto the localized reservation start path", () => {
    expect(getReservationStartPath("cs-CZ", "meeting-room")).toBe(
      "/cs-CZ/reservation/meeting-room"
    );
    expect(
      getReservationStartPath(
        "en-US",
        "cowork",
        new URLSearchParams({ payState: "signed-state" })
      )
    ).toBe("/en-US/reservation/cowork?payState=signed-state");
  });

  test("serves every reservation path from an app route", () => {
    for (const path of [
      coworkReservationPath,
      meetingRoomReservationPath,
      officeReservationPath,
    ]) {
      expect(appRouteExists(`${path}/page.tsx`)).toBe(true);
    }
    for (const path of [
      reservationAccessPath,
      reservationInvoicePath,
      reservationStatusPath,
    ]) {
      expect(appRouteExists(`${path}/[orderId]/page.tsx`)).toBe(true);
    }
  });
});
