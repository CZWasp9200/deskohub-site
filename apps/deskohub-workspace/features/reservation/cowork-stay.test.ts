import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Result, Schema } from "effect";
import "@/shared/polyfills/temporal";
import {
  type CoworkReservationOrderInput,
  coworkCurrentReservationOrderSchema,
  getCoworkReservationDetails,
  getCoworkReservationInterval,
  getCoworkReservationIntervalInput,
} from "./cowork-reservation";
import { getStoredCoworkReservationDetails } from "./cowork-reservation-product";
import { coworkStaySchema, getBookedCoworkStay } from "./cowork-stay";
import {
  coworkReservationIntervalSchema,
  reservationIntervalSchema,
} from "./reservation-interval";

const normalize = Schema.decodeSync(reservationIntervalSchema);

describe("cowork stay interval", () => {
  test("runs an overnight Reserved Desk stay from noon on the arrival date to noon the next day", () => {
    expect(
      getCoworkReservationIntervalInput(
        "reserved-desk",
        "2099-06-10",
        "overnight"
      )
    ).toEqual({
      startsAt: "2099-06-10T12:00",
      endsAt: "2099-06-11T12:00",
    });
  });

  test("keeps a day stay, or no stay, on the arrival date's Prague calendar day", () => {
    const day = getCoworkReservationIntervalInput(
      "reserved-desk",
      "2099-06-10",
      "day"
    );
    expect(day).toEqual({
      startsAt: "2099-06-10T00:00",
      endsAt: "2099-06-11T00:00",
    });
    expect(
      getCoworkReservationIntervalInput("reserved-desk", "2099-06-10")
    ).toEqual(day);
  });

  test("keeps wall-clock noon across daylight-saving changes", () => {
    // The night into 2026-10-25 lasts 25 hours; into 2027-03-28, 23 hours.
    const fall = normalize(
      getCoworkReservationIntervalInput(
        "reserved-desk",
        "2026-10-24",
        "overnight"
      )
    );
    expect(fall).toEqual({
      startsAt: "2026-10-24T10:00:00Z",
      endsAt: "2026-10-25T11:00:00Z",
    });
    const spring = normalize(
      getCoworkReservationIntervalInput(
        "reserved-desk",
        "2027-03-27",
        "overnight"
      )
    );
    expect(spring).toEqual({
      startsAt: "2027-03-27T11:00:00Z",
      endsAt: "2027-03-28T10:00:00Z",
    });
  });

  test("resolves the same instants as normalizing the local overnight interval", () => {
    for (const date of ["2026-10-24", "2027-03-27", "2099-06-10"]) {
      expect(
        getCoworkReservationInterval("reserved-desk", date, "overnight")
      ).toEqual(
        normalize(
          getCoworkReservationIntervalInput("reserved-desk", date, "overnight")
        )
      );
    }
  });

  test("accepts the overnight interval as a cowork interval", () => {
    const decode = Schema.decodeUnknownResult(coworkReservationIntervalSchema);
    expect(
      decode(
        getCoworkReservationIntervalInput(
          "reserved-desk",
          "2026-10-24",
          "overnight"
        )
      )._tag
    ).toBe("Success");
    expect(
      decode({ startsAt: "2099-06-10T12:00", endsAt: "2099-06-11T13:00" })._tag
    ).toBe("Failure");
    expect(
      decode({ startsAt: "2099-06-10T12:00", endsAt: "2099-06-12T12:00" })._tag
    ).toBe("Failure");
  });
});

describe("booked cowork stay", () => {
  test("derives an overnight stay from Reserved Desk bounds at noon on consecutive dates", () => {
    for (const date of ["2026-10-24", "2027-03-27", "2099-06-10"]) {
      expect(
        getBookedCoworkStay({
          tier: "reserved-desk",
          interval: getCoworkReservationInterval(
            "reserved-desk",
            date,
            "overnight"
          ),
        })
      ).toBe("overnight");
    }
  });

  test("derives a day stay from any other bounds", () => {
    expect(
      getBookedCoworkStay({
        tier: "reserved-desk",
        interval: getCoworkReservationInterval("reserved-desk", "2099-06-10"),
      })
    ).toBe("day");
    expect(
      getBookedCoworkStay({
        tier: "reserved-desk",
        interval: normalize({
          startsAt: "2099-06-10T12:00",
          endsAt: "2099-06-12T12:00",
        }),
      })
    ).toBe("day");
    expect(
      getBookedCoworkStay({
        tier: "reserved-desk",
        interval: normalize({
          startsAt: "2099-06-10T12:30",
          endsAt: "2099-06-11T12:30",
        }),
      })
    ).toBe("day");
  });

  test("derives a day stay for tiers other than Reserved Desk", () => {
    const noonToNoon = getCoworkReservationInterval(
      "reserved-desk",
      "2099-06-10",
      "overnight"
    );
    expect(
      getBookedCoworkStay({ tier: "open-space", interval: noonToNoon })
    ).toBe("day");
    expect(getBookedCoworkStay({ tier: "profi", interval: noonToNoon })).toBe(
      "day"
    );
  });
});

describe("cowork stay schema", () => {
  test("accepts day and overnight only", () => {
    const decode = Schema.decodeUnknownResult(coworkStaySchema);
    expect(decode("day")._tag).toBe("Success");
    expect(decode("overnight")._tag).toBe("Success");
    expect(decode("night")._tag).toBe("Failure");
  });
});

describe("cowork order stay", () => {
  const decodeOrder = Schema.decodeUnknownResult(
    coworkCurrentReservationOrderSchema("CZ")
  );
  const order = (
    fields: Partial<
      Pick<CoworkReservationOrderInput, "entryTier" | "stay">
    > = {}
  ) => ({
    kind: "cowork",
    entryTier: "reserved-desk",
    date: "2099-06-10",
    coffee: true,
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777777777",
    ...fields,
  });

  test("keeps an overnight Reserved Desk stay on the order", () => {
    const decoded = Result.getOrThrow(
      decodeOrder(order({ stay: "overnight" }))
    );
    expect(decoded).toMatchObject({
      entryTier: "reserved-desk",
      stay: "overnight",
    });
  });

  test("books a day stay without a stay key, whether the stay is missing or day", () => {
    for (const fields of [{}, { stay: "day" }] as const) {
      const decoded = Result.getOrThrow(decodeOrder(order(fields)));
      expect("stay" in decoded).toBe(false);
    }
  });

  test("rejects an overnight stay for Open Space", () => {
    expect(
      Result.isFailure(
        decodeOrder(order({ entryTier: "open-space", stay: "overnight" }))
      )
    ).toBe(true);
  });

  test("carries the stay into checkout details but never into stored details", () => {
    const decoded = Result.getOrThrow(
      decodeOrder(order({ stay: "overnight" }))
    );
    const checkoutReservation = getCoworkReservationDetails(decoded);
    expect(checkoutReservation).toMatchObject({ stay: "overnight" });
    expect(
      "stay" in getStoredCoworkReservationDetails(checkoutReservation)
    ).toBe(false);
  });
});
