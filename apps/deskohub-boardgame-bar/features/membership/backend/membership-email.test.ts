import { describe, expect, it } from "bun:test";
import {
  buildMembershipActivatedEmail,
  buildMembershipExpiringEmail,
  type MembershipEmailDetails,
} from "./membership-email";

const details: MembershipEmailDetails = {
  email: "karel@example.test",
  name: "Kostkový Karel",
  planName: "Měsíční členství",
  // 23:30 UTC is already the next day at the bar.
  startsAt: new Date("2026-11-13T23:30:00Z"),
  endsAt: new Date("2026-12-13T23:30:00Z"),
  locale: "cs-CZ",
};

describe("membership emails", () => {
  it("confirms the active membership with its period in the bar's dates", () => {
    const message = buildMembershipActivatedEmail(details);

    expect(message.to).toEqual({ email: "karel@example.test" });
    expect(message.subject).toBe("Vaše členství v Deskohubu platí");
    expect(message.text).toContain("Dobrý den, Kostkový Karel,");
    expect(message.text).toContain(
      "Měsíční členství platí od 14. listopadu 2026 do 14. prosince 2026"
    );
    expect(message.text).toContain("/cs-CZ/account");
    expect(message.tags).toEqual(["membership-activated"]);
  });

  it("reminds the member of the end date and how to renew", () => {
    const message = buildMembershipExpiringEmail(details);

    expect(message.subject).toBe("Vaše členství v Deskohubu brzy skončí");
    expect(message.text).toContain(
      "Měsíční členství platí do 14. prosince 2026"
    );
    expect(message.text).toContain("zaplaťte ho na baru");
    expect(message.html).toContain("Prodloužit členství");
    expect(message.tags).toEqual(["membership-expiring"]);
  });

  it("writes the email in the member's language", () => {
    const message = buildMembershipActivatedEmail({
      ...details,
      locale: "en-US",
    });

    expect(message.subject).toBe("Your Deskohub membership is active");
    expect(message.text).toContain("Hello Kostkový Karel,");
    expect(message.text).toContain("/en-US/account");
  });
});
