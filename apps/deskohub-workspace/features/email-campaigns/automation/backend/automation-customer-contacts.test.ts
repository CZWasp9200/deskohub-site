import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Option } from "effect";
import { inactiveCustomerDisplayNames } from "@/features/administration/customer-name";
import { readAutomationCustomerContacts } from "./automation-customer-contacts";

const customer = (
  id: string,
  fields: Partial<DotyposCustomer> = {}
): DotyposCustomer =>
  ({
    id,
    firstName: "Synthetic",
    lastName: id,
    email: testEmailAddress(id),
    phone: "+420 600 000 000",
    deleted: false,
    ...fields,
  }) as DotyposCustomer;

const read = (customers: readonly DotyposCustomer[]) =>
  Effect.runPromise(
    readAutomationCustomerContacts(
      customers.map(({ id }) => id as DotyposCustomerId)
    ).pipe(Effect.provide(makeInMemoryDotypos({ customers }).layer))
  ).then(Option.getOrThrow);

describe("readAutomationCustomerContacts", () => {
  test("reads an active customer's name and email", async () => {
    const contacts = await read([customer("customer-active")]);

    expect(contacts.get("customer-active" as DotyposCustomerId)).toEqual({
      name: "Synthetic customer-active",
      email: testEmailAddress("customer-active"),
    });
  });

  test.each([
    ["deleted", { deleted: true }],
    ["expired", { expireDate: "2020-01-01T00:00:00Z" }],
  ] as const)(
    "names a %s customer only by the placeholder, without their email",
    async (lifecycle, fields) => {
      const inactive = customer(`customer-${lifecycle}`, fields);
      const contacts = await read([inactive]);

      expect(contacts.get(inactive.id)).toEqual({
        name: inactiveCustomerDisplayNames[lifecycle],
        email: null,
      });
    }
  );
});
