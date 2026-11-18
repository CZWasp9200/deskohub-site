import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AdministrationWorkspaceReservationId } from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";
import { administrationHref } from "./administration-href";
import { m } from "./i18n";
import { ReservationAdministrationError } from "./reservation-administration-error";
import { getReservationRestorationErrorMessage } from "./reservation-error-messages";
import type { ReservationRestorationInput } from "./reservation-restoration.service";

const request = await mockAdministrationActionRequest({
  administrator: "restore-actor",
  referer: "https://deskohub.test/en-US/admin/reservations",
});
const { access } = request;

const restoreCalls: ReservationRestorationInput[] = [];
const revalidatedPaths: string[] = [];
let restoreResult: Effect.Effect<unknown, unknown> = Effect.void;

class StubReservationAdministrationService extends Context.Service<
  StubReservationAdministrationService,
  {
    readonly restore: (
      input: ReservationRestorationInput
    ) => Effect.Effect<unknown, unknown>;
  }
>()("@test/ReservationAdministrationService") {}

mock.module("./reservation-administration.service", () => ({
  ReservationAdministrationError,
  ReservationAdministrationService: Object.assign(
    StubReservationAdministrationService,
    {
      Live: Layer.succeed(
        StubReservationAdministrationService,
        StubReservationAdministrationService.of({
          restore: (input) => {
            restoreCalls.push(input);
            return restoreResult;
          },
        })
      ),
    }
  ),
}));

mock.module("@/features/i18n/server/revalidate-localized-path", () => ({
  revalidateLocalizedPath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

const { restoreAdministrationReservation } = await import("./actions");

class UnexpectedRestorationFailure extends Data.TaggedError(
  "UnexpectedRestorationFailure"
)<{ readonly message: string }> {}

const reservationId = Schema.decodeSync(AdministrationWorkspaceReservationId)(
  "01980000-0000-7000-8000-0000000000c1"
);
const restoration = {
  reservationId,
  acknowledgeRefundedPayment: true,
  sendRestorationEmail: false,
};
const privateMessage = "Private restoration detail for the log only.";

beforeEach(() => {
  request.reset();
  restoreCalls.length = 0;
  revalidatedPaths.length = 0;
  restoreResult = Effect.succeed({
    outcome: "restored",
    email: "not_requested",
    access: "issued",
    invoice: null,
  });
});

describe("restoreAdministrationReservation action", () => {
  test("hands the operator's choices to the restore service unchanged and refreshes the detail", async () => {
    const result = await restoreAdministrationReservation(restoration);

    expect(result).toEqual({
      data: {
        outcome: "restored",
        email: "not_requested",
        access: "issued",
        invoice: null,
      },
    });
    expect(restoreCalls).toEqual([restoration]);
    expect(revalidatedPaths).toEqual([
      administrationHref("/[locale]/admin/reservations/[reservationId]", {
        reservationId,
      }),
    ]);
  });

  test.each([
    ["an unknown field", { ...restoration, force: true }],
    [
      "a missing reservation",
      { acknowledgeRefundedPayment: false, sendRestorationEmail: true },
    ],
    ["a missing choice", { reservationId, acknowledgeRefundedPayment: false }],
  ])("rejects %s before the service runs", async (_, input) => {
    const result = await restoreAdministrationReservation(
      input as typeof restoration
    );

    expect(result).toHaveProperty("validationErrors");
    expect(restoreCalls).toEqual([]);
  });

  test("words a refund refusal with the refunded amount, never the service message", async () => {
    const refundedPayment = {
      amount: { value: 25_000, exponent: 2, currency: "CZK" },
      coverage: "partial",
    } as const;
    restoreResult = Effect.fail(
      new ReservationAdministrationError({
        code: "not_restorable",
        reason: "refund_acknowledgement_required",
        refundedPayment,
        message: privateMessage,
      })
    );

    const result = await restoreAdministrationReservation(restoration);

    expect(result).toEqual({
      serverError: getReservationRestorationErrorMessage(
        "refund_acknowledgement_required",
        "en-US",
        refundedPayment
      ),
    });
    expect(JSON.stringify(result)).not.toContain(privateMessage);
    expect(revalidatedPaths).toEqual([]);
  });

  test("words a typed refusal by its reason", async () => {
    restoreResult = Effect.fail(
      new ReservationAdministrationError({
        code: "restoration_failed",
        reason: "dotypos_failed",
        message: privateMessage,
      })
    );

    expect(await restoreAdministrationReservation(restoration)).toEqual({
      serverError: getReservationRestorationErrorMessage(
        "dotypos_failed",
        "en-US"
      ),
    });
  });

  test("answers any other failure with the generic restoration failure", async () => {
    restoreResult = Effect.fail(
      new UnexpectedRestorationFailure({ message: privateMessage })
    );

    expect(await restoreAdministrationReservation(restoration)).toEqual({
      serverError: m.administrationReservationRestorationFailed(
        {},
        { locale: "en-US" }
      ),
    });
  });

  test.each(["not-administrator", "signed-out"] as const)(
    "fails closed for a caller who is %s",
    async (state) => {
      access.set(state);

      const result = await restoreAdministrationReservation(restoration);

      expect(result).toHaveProperty("serverError");
      expect(result).not.toHaveProperty("data");
      expect(restoreCalls).toEqual([]);
    }
  );
});
