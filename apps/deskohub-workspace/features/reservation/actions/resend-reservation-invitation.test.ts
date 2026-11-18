import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { InvitationResendRefused } from "@/features/reservation-invitees/backend/reservation-invitations.service";

mock.module("server-only", () => ({}));
mock.module("@/shared/backend/bot-protection/bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => false,
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));
mock.module("next/server", () => ({ after: () => undefined }));
const orderId = workspaceReservationIdSchema.make("office-order");
const inviteeId = "office-guest";
const ownerCookie = "synthetic-owner-cookie";
let owner = true;
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      owner && name === getReservationAccessCookieName(orderId)
        ? { value: ownerCookie }
        : undefined,
    getAll: () => [],
  }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

const authorization = await import(
  "@/features/reservation/backend/reservation-authorization.service"
);
class ReservationAuthorizationService extends authorization.ReservationAuthorizationService {
  static override Live = Layer.mock(
    authorization.ReservationAuthorizationService,
    {}
  );
}
mock.module(
  "@/features/reservation/backend/reservation-authorization.service",
  () => ({
    ...authorization,
    ReservationAuthorizationService,
  })
);

const nextAvailable = Temporal.Instant.from("2026-11-19T09:05:00.123Z");
let cooldown = false;
const resend = mock((input: { readonly accessCookie?: string }) => {
  if (input.accessCookie !== ownerCookie) {
    return Effect.fail(
      new InvitationResendRefused({ refusal: { reason: "not-found" } })
    );
  }
  if (cooldown) {
    return Effect.fail(
      new InvitationResendRefused({
        refusal: { reason: "cooldown", retryAt: nextAvailable },
      })
    );
  }
  return Effect.succeed({ resendAvailableAt: nextAvailable });
});
mock.module(
  "@/features/reservation-invitees/backend/resend-reservation-invitation",
  () => ({
    resendAuthorizedReservationInvitation: resend,
    resendReservationInvitationServices: Layer.empty,
  })
);

const { resendReservationInvitation } = await import(
  "./resend-reservation-invitation"
);

test("the invitation Server Action returns ISO instants and a generic denial", async () => {
  const input = { orderId, inviteeId };
  expect(await resendReservationInvitation(input)).toEqual({
    status: "sent",
    resendAvailableAt: "2026-11-19T09:05:00.123Z",
  });
  expect(resend).toHaveBeenCalledWith({
    ...input,
    locale: "en-US",
    accessCookie: ownerCookie,
  });

  cooldown = true;
  expect(await resendReservationInvitation(input)).toEqual({
    status: "cooldown",
    retryAt: "2026-11-19T09:05:00.123Z",
  });

  owner = false;
  expect(await resendReservationInvitation(input)).toEqual({
    status: "failed",
  });
  expect(resend).toHaveBeenLastCalledWith({
    ...input,
    locale: "en-US",
    accessCookie: undefined,
  });
});
