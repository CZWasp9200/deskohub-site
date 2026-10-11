import { describe, expect, mock, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Deferred, Effect, Layer } from "effect";
import {
  type CurrentLinkedAccount,
  CustomerAccountContactService,
} from "@/features/account/backend/customer-account-contact.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { CustomerLastReservation } from "@/features/reservation/reservation-existing-customer";
import { CustomerLastReservationService } from "./customer-last-reservation.service";

mock.module("server-only", () => ({}));

const { loadLinkedExistingCustomer } = await import(
  "./reservation-existing-customer.server"
);

const account: CurrentLinkedAccount = {
  accountId: customerAccountIdSchema.make("auth-user-1"),
  dotyposCustomerId: "60111" as DotyposCustomerId,
  email: reservationCustomerEmailSchema.make("ada@example.test"),
};

const contact = {
  ...account,
  name: "Ada Lovelace",
  phone: "+420 777 777 777",
};

const lastReservation: CustomerLastReservation = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: true,
};

const runLoad = (options: {
  readonly currentLinkedAccount?: CurrentLinkedAccount | null;
  readonly linkedContact: CustomerAccountContactService["Service"]["linkedContact"];
  readonly load: CustomerLastReservationService["Service"]["load"];
}) =>
  loadLinkedExistingCustomer("cowork").pipe(
    Effect.timeout("1 second"),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(CustomerAccountContactService, {
          currentLinkedAccount: Effect.succeed(
            options.currentLinkedAccount === undefined
              ? account
              : options.currentLinkedAccount
          ),
          linkedContact: options.linkedContact,
        }),
        Layer.mock(CustomerLastReservationService, { load: options.load })
      )
    ),
    Effect.result,
    Effect.runPromise
  );

describe("loadLinkedExistingCustomer", () => {
  test("reads neither the profile nor the last reservation without a link", async () => {
    const linkedContact = mock(() => Effect.succeed(contact));
    const load = mock(() => Effect.succeed(lastReservation as never));

    const outcome = await runLoad({
      currentLinkedAccount: null,
      linkedContact,
      load,
    });

    expect(outcome).toMatchObject({ _tag: "Success", success: undefined });
    expect(linkedContact).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  test("loads the contact and the last reservation concurrently from the link", async () => {
    const lastReservationStarted = Deferred.makeUnsafe<void>();
    const contactStarted = Deferred.makeUnsafe<void>();
    // Each read waits for the other to start, so a sequential load times out.
    const linkedContact = mock((_account: CurrentLinkedAccount) =>
      Deferred.succeed(contactStarted, undefined).pipe(
        Effect.andThen(Deferred.await(lastReservationStarted)),
        Effect.as(contact)
      )
    );
    const load = mock(() =>
      Deferred.succeed(lastReservationStarted, undefined).pipe(
        Effect.andThen(Deferred.await(contactStarted)),
        Effect.as(lastReservation as never)
      )
    );

    const outcome = await runLoad({ linkedContact, load });

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: {
        contact: {
          name: "Ada Lovelace",
          email: "ada@example.test",
          phone: "+420 777 777 777",
        },
        lastReservation,
      },
    });
    expect(linkedContact).toHaveBeenCalledWith(account);
    expect(load).toHaveBeenCalledWith(account.dotyposCustomerId, "cowork");
  });

  test("keeps the account contact when the last reservation fails", async () => {
    const outcome = await runLoad({
      linkedContact: () => Effect.succeed(contact),
      load: () => Effect.fail(new Error("database unavailable") as never),
    });

    expect(outcome._tag).toBe("Success");
    if (outcome._tag !== "Success") throw new Error("Expected a customer");
    expect(outcome.success).toEqual({
      contact: {
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "+420 777 777 777",
      },
    });
  });

  test("discards the last reservation when the profile cannot book", async () => {
    const outcome = await runLoad({
      linkedContact: () => Effect.succeed(null),
      load: () => Effect.succeed(lastReservation as never),
    });

    expect(outcome).toMatchObject({ _tag: "Success", success: undefined });
  });

  test("fails on a profile failure and interrupts the pending last reservation", async () => {
    const profileFailure = new CustomerAccountAccessError({
      reason: "unavailable",
    });
    const lastReservationStarted = Deferred.makeUnsafe<void>();
    let lastReservationInterrupted = false;

    const outcome = await runLoad({
      linkedContact: () =>
        Deferred.await(lastReservationStarted).pipe(
          Effect.andThen(Effect.fail(profileFailure))
        ),
      load: () =>
        Deferred.succeed(lastReservationStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              lastReservationInterrupted = true;
            })
          )
        ),
    });

    expect(outcome).toMatchObject({ _tag: "Failure", failure: profileFailure });
    expect(lastReservationInterrupted).toBe(true);
  });
});
