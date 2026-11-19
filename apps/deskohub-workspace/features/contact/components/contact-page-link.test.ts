import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { getContactPageHref, readContactPrefill } from "./contact-page-link";

const email = testEmailAddress("contact-page-link");

describe("contact page link", () => {
  test("opens the locale's contact page with the form prefilled", () => {
    const prefill = {
      name: "Alex Sample",
      email,
      message: "First line\n\nAdd:\nRemove:",
    };
    const href = new URL(
      getContactPageHref("en-US", prefill),
      "https://x.test"
    );

    expect(href.pathname).toBe("/en-US/contact");
    expect(readContactPrefill(href.searchParams)).toEqual({
      ...prefill,
      phone: undefined,
    });
  });

  test("leaves out empty fields", () => {
    expect(getContactPageHref("cs-CZ", { name: "", email })).toBe(
      `/cs-CZ/contact?email=${encodeURIComponent(email)}`
    );
    expect(getContactPageHref("cs-CZ", {})).toBe("/cs-CZ/contact");
  });

  test("cuts values to what the contact page accepts", () => {
    const href = new URL(
      getContactPageHref("en-US", { message: "x".repeat(1200) }),
      "https://x.test"
    );

    expect(readContactPrefill(href.searchParams)?.message).toHaveLength(1000);
  });

  test("reads no prefill from a plain contact link", () => {
    expect(readContactPrefill(new URLSearchParams())).toBeUndefined();
  });
});
