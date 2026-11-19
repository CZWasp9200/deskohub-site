import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Option } from "effect";
import type { Locale } from "@/features/i18n";
import type {
  CheckoutOfficeSelection,
  ReservationCheckoutContact,
} from "@/features/reservation/reservation-checkout-contact";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";

mock.module("server-only", () => ({}));

const draftCookies = new Map<string, string>();
const setCookie = mock(
  (
    name: string,
    value: string,
    _options: {
      readonly httpOnly: boolean;
      readonly sameSite: string;
      readonly maxAge: number;
    }
  ) => draftCookies.set(name, value)
);
mock.module("@/shared/backend/utils/request-cookies", () => ({
  getRequestCookies: Effect.succeed({
    get: (name: string) =>
      draftCookies.has(name) ? { value: draftCookies.get(name) } : undefined,
    set: setCookie,
  }),
}));

type SealInput = ReservationCheckoutContact & {
  readonly officeSelection?: CheckoutOfficeSelection;
};
type SealHandler = (
  input: SealInput,
  context: { readonly locale: Locale }
) => Effect.Effect<{ readonly token: string }>;

type SealOptions = {
  readonly schema: (locale: Locale) => StandardSchemaV1<unknown, SealInput>;
};

let defined:
  | { readonly options: SealOptions; readonly handler: SealHandler }
  | undefined;

// The action pipeline, including building the schema for the action's
// locale, is covered by the workspace action tests; here the action's own
// schema and handler run directly.
mock.module("@/shared/backend/workspace-action", () => ({
  defineWorkspaceAction: (options: SealOptions, handler: SealHandler) => {
    defined = { options, handler };
    return async () => undefined;
  },
}));

await import("./seal-checkout-contact");
const {
  checkoutContactReturnState,
  checkoutOfficeSelectionCookieName,
  loadCheckoutOfficeSelection,
} = await import(
  "@/features/reservation/backend/checkout-contact-return-state"
);

const action = () => {
  if (!defined) throw new Error("The seal action was not defined");
  return defined;
};

const contactWithPhone = (phone: string): ReservationCheckoutContact => ({
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone,
  billing: { purpose: "personal", invoice: "none" },
  marketingConsent: true,
});

const validate = async (
  locale: Locale,
  input: SealInput & { readonly locale?: Locale }
) => await action().options.schema(locale)["~standard"].validate(input);

const sealUnder = async (locale: Locale, phone: string) => {
  const result = await validate(locale, contactWithPhone(phone));
  if (result.issues) return { sealed: false as const };
  const { token } = await Effect.runPromise(
    action().handler(result.value, { locale })
  );
  return { sealed: true as const, token };
};

const reopen = (token: string, pageLocale: Locale) =>
  Effect.runPromise(
    checkoutContactReturnState
      .open(token, pageLocale)
      .pipe(Effect.option, Effect.provide(TestSealedStateKeys))
  ).then(Option.getOrUndefined);

describe("sealing a checkout contact", () => {
  beforeEach(() => {
    draftCookies.clear();
    setCookie.mockClear();
  });

  test.each([
    ["de-DE", "0151 23456789", "cs-CZ"],
    ["uk-UA", "050 123 4567", "cs-CZ"],
  ] as const)(
    "seals a %s national number (%s) that %s rejects",
    async (locale, phone, otherLocale) => {
      expect(await sealUnder(locale, phone)).toMatchObject({ sealed: true });
      expect(await sealUnder(otherLocale, phone)).toEqual({ sealed: false });
    }
  );

  test.each(["cs-CZ", "en-US", "de-DE", "uk-UA"] as const)(
    "seals a number with a country calling code under %s",
    async (locale) => {
      expect(await sealUnder(locale, "+420 777 123 456")).toMatchObject({
        sealed: true,
      });
    }
  );

  test("seals the action's locale, so the phone reopens in its region", async () => {
    const sealed = await sealUnder("de-DE", "0151 23456789");
    if (!sealed.sealed) throw new Error("Expected the contact to seal");

    expect(await reopen(sealed.token, "de-DE")).toEqual(
      contactWithPhone("0151 23456789")
    );
    // A cs-CZ page doesn't read the number as a Czech one.
    expect(await reopen(sealed.token, "cs-CZ")).toEqual(
      contactWithPhone("+49 1512 3456789")
    );
  });

  test("rejects a property the contact doesn't have", async () => {
    const result = await validate("cs-CZ", {
      ...contactWithPhone("+420 777 123 456"),
      locale: "de-DE",
    });

    expect(result.issues?.length).toBeGreaterThan(0);
  });

  test("keeps attendees in an isolated HTTP-only cookie, outside the return token", async () => {
    const contact = contactWithPhone("+420 777 123 456");
    const first: CheckoutOfficeSelection = {
      kind: "people",
      people: { contactAttends: false, invitees: [testEmailAddress("guest")] },
    };
    const second = { kind: "seats", seats: 3 } as const;
    const issue = async (officeSelection: CheckoutOfficeSelection) => {
      const parsed = await validate("en-US", { ...contact, officeSelection });
      if (parsed.issues) throw new Error("Expected valid checkout details");
      const { token } = await Effect.runPromise(
        action().handler(parsed.value, { locale: "en-US" })
      );
      const opened = await reopen(token, "en-US");
      if (!opened?.officeSelectionId)
        throw new Error("Missing draft identifier");
      expect(opened).toEqual({
        ...contact,
        officeSelectionId: opened.officeSelectionId,
      });
      return opened.officeSelectionId;
    };
    const read = (id: string) =>
      Effect.runPromise(
        loadCheckoutOfficeSelection(id).pipe(
          Effect.provide(TestSealedStateKeys)
        )
      );
    const firstId = await issue(first);
    const secondId = await issue(second);
    expect(firstId).not.toBe(secondId);
    expect(setCookie.mock.calls[0]?.[2]).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1800,
    });
    expect(await read(firstId)).toEqual(first);
    expect(await read(secondId)).toEqual(second);

    const firstName = checkoutOfficeSelectionCookieName(firstId);
    const secondDraft = draftCookies.get(
      checkoutOfficeSelectionCookieName(secondId)
    );
    if (!secondDraft) throw new Error("Missing second checkout draft");
    draftCookies.set(firstName, secondDraft);
    expect(await read(firstId)).toBeUndefined();
    draftCookies.delete(firstName);
    expect(await read(firstId)).toBeUndefined();
  });

  test("rejects the contact's address or duplicates as invitees", async () => {
    const contact = contactWithPhone("+420 777 123 456");
    const guestEmail = testEmailAddress("guest");
    for (const invitees of [
      [contact.email],
      [guestEmail, guestEmail.toUpperCase()],
    ]) {
      const parsed = await validate("en-US", {
        ...contact,
        officeSelection: {
          kind: "people",
          people: { contactAttends: false, invitees },
        },
      });
      expect(parsed.issues).toBeDefined();
    }
  });
});
