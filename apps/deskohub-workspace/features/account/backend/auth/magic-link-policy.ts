import type { EmailTestDomain } from "@deskohub/email";

/**
 * Only `delivered+<run-id>-<label>@<EMAIL_TEST_DOMAIN>` is a synthetic E2E
 * account. Every test-domain recipient is logged by Console, but only this
 * shape may enter the Preview bearer-log route.
 */
export const magicLinkSyntheticLocalPartPattern =
  /^delivered\+[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+$/i;

export const isSyntheticE2EEmailRecipient = (
  email: string,
  testDomain: EmailTestDomain
): boolean => {
  const separator = email.lastIndexOf("@");
  return (
    separator > 0 &&
    email.slice(separator + 1).toLowerCase() === testDomain &&
    magicLinkSyntheticLocalPartPattern.test(email.slice(0, separator))
  );
};

/**
 * Code for the sole authorized bearer-link log in synthetic protected Preview.
 */
export const magicLinkPreviewE2ELogCode = "account.magic-link.preview-e2e";

/** Non-secret correlation identity shared by Workspace magic-link messages. */
export const accountMagicLinkEmailCategoryTag = "account-magic-link";
export const accountMagicLinkEmailSurface = "workspace";
