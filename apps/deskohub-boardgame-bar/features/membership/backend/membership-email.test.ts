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
  it("confirms the period to the member in the bar's dates", () => {
    const message = buildMembershipActivatedEmail(details);

    expect(message.to).toEqual({ email: "karel@example.test" });
    expect(message.text).toContain(details.name);
    expect(message.text).toContain(details.planName);
    expect(message.text).toContain("14. listopadu 2026");
    expect(message.text).toContain("14. prosince 2026");
    expect(message.text).toContain("/cs-CZ/account");
    expect(message.tags).toEqual(["membership-activated"]);
  });

  it("reminds the member of the end date", () => {
    const message = buildMembershipExpiringEmail(details);

    expect(message.to).toEqual({ email: "karel@example.test" });
    expect(message.text).toContain("14. prosince 2026");
    expect(message.text).not.toContain("14. listopadu 2026");
    expect(message.html).toContain("/cs-CZ/account");
    expect(message.tags).toEqual(["membership-expiring"]);
  });

  it("shows the day before when the membership ends at midnight", () => {
    const message = buildMembershipExpiringEmail({
      ...details,
      // 1 January 00:00 in Prague: 31 December is the last day.
      endsAt: new Date("2026-12-31T23:00:00Z"),
    });

    expect(message.text).toContain("31. prosince 2026");
    expect(message.text).not.toContain("1. ledna 2027");
  });

  it("escapes the member's name in the HTML", () => {
    const message = buildMembershipActivatedEmail({
      ...details,
      name: "<b>Karel</b>",
    });

    expect(message.html).toContain("&lt;b&gt;Karel&lt;/b&gt;");
    expect(message.html).not.toContain("<b>Karel</b>");
  });

  it("writes the email in the member's language", () => {
    const czech = buildMembershipActivatedEmail(details);
    const english = buildMembershipActivatedEmail({
      ...details,
      locale: "en-US",
    });

    expect(english.subject).not.toBe(czech.subject);
    expect(english.text).toContain("November 14, 2026");
    expect(english.text).toContain("/en-US/account");
  });
});
