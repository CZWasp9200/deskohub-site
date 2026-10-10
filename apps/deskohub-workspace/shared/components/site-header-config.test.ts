import { beforeEach, describe, expect, mock, test } from "bun:test";

const isMeetingRoomPageEnabled = mock();
const isOfficePageEnabled = mock();
const areAccountsEnabled = mock();
const isCustomerSignedIn = mock();

mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
}));

mock.module("@/features/account/server/customer-session.server", () => ({
  isCustomerSignedIn,
}));

mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({ isMeetingRoomPageEnabled })
);
mock.module(
  "@/features/office/backend/office-reservation-feature-flag.server",
  () => ({
    isOfficePageEnabled,
  })
);

describe("getSiteHeaderConfig", () => {
  beforeEach(() => {
    areAccountsEnabled.mockReset();
    isCustomerSignedIn.mockReset();
    isMeetingRoomPageEnabled.mockReset();
    isOfficePageEnabled.mockReset();
    areAccountsEnabled.mockResolvedValue(true);
    isCustomerSignedIn.mockResolvedValue(false);
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    isOfficePageEnabled.mockResolvedValue(false);
  });

  test("omits the Meeting Room item when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links).not.toContainEqual(
      expect.objectContaining({
        id: "meetingRoom",
        href: "/cs-CZ/meeting-room",
      })
    );
    expect(config).not.toHaveProperty("disabledMenuItems");
  });

  test("includes the Meeting Room link when its release flag is enabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(true);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.links).toContainEqual(
      expect.objectContaining({
        id: "meetingRoom",
        href: "/en-US/meeting-room",
      })
    );
    expect(config).not.toHaveProperty("disabledMenuItems");
  });

  test("uses compact English labels for the public navigation", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.links.map(({ label }) => label)).toEqual([
      "Location",
      "Photos",
      "Team",
      "FAQ",
      "Contact",
    ]);
  });

  test("uses compact Czech labels for the public navigation", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links.map(({ label }) => label)).toEqual([
      "Poloha",
      "Fotky",
      "Tým",
      "FAQ",
      "Kontakt",
    ]);
  });

  test("links Team and FAQ to their localized standalone pages", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    const en = await getSiteHeaderConfig("en-US");
    const cs = await getSiteHeaderConfig("cs-CZ");

    expect(en.links).toContainEqual(
      expect.objectContaining({ id: "team", href: "/en-US/team" })
    );
    expect(en.links).toContainEqual(
      expect.objectContaining({ id: "faq", href: "/en-US/faq" })
    );
    expect(cs.links).toContainEqual(
      expect.objectContaining({ id: "team", href: "/cs-CZ/team" })
    );
    expect(cs.links).toContainEqual(
      expect.objectContaining({ id: "faq", href: "/cs-CZ/faq" })
    );
  });

  test("omits the Private Office link when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links).not.toContainEqual(
      expect.objectContaining({ href: "/cs-CZ/reservation/office" })
    );
  });

  test("includes the Private Office link when its release flag is enabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isOfficePageEnabled.mockResolvedValue(true);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.links).toContainEqual(
      expect.objectContaining({ href: "/en-US/reservation/office" })
    );
  });

  test("points a signed-in customer's account entry at the localized account page", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isCustomerSignedIn.mockResolvedValue(true);

    const en = await getSiteHeaderConfig("en-US");
    expect(await en.account?.href).toBe("/en-US/account");
    expect(en.account?.label).toBe("Account");

    const cs = await getSiteHeaderConfig("cs-CZ");
    expect(await cs.account?.href).toBe("/cs-CZ/account");
    expect(cs.account?.label).toBe("Účet");
    expect(isCustomerSignedIn).toHaveBeenCalledWith("site-header.account-link");
  });

  test("points an anonymous customer's account entry at the localized sign-in page", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");

    const en = await getSiteHeaderConfig("en-US");
    expect(await en.account?.href).toBe("/en-US/auth/sign-in");
    expect(en.account?.signInHref).toBe("/en-US/auth/sign-in");

    const cs = await getSiteHeaderConfig("cs-CZ");
    expect(await cs.account?.href).toBe("/cs-CZ/auth/sign-in");
    expect(cs.account?.signInHref).toBe("/cs-CZ/auth/sign-in");
  });

  test("falls back to the sign-in page when the session check fails", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isCustomerSignedIn.mockRejectedValue(new Error("session unavailable"));

    const config = await getSiteHeaderConfig("en-US");

    expect(await config.account?.href).toBe("/en-US/auth/sign-in");
  });

  test("omits the account entry when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    areAccountsEnabled.mockResolvedValue(false);

    const config = await getSiteHeaderConfig("en-US");

    expect(config).not.toHaveProperty("account");
    expect(isCustomerSignedIn).not.toHaveBeenCalled();
  });
});
