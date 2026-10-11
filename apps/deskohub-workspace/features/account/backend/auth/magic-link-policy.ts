/**
 * Only `delivered+<run-id>-<label>@resend.dev` is a synthetic E2E account.
 * Every `resend.dev` recipient is logged by Console, but only this shape may
 * enter the Preview bearer-log route.
 */
export const magicLinkSyntheticRecipientPattern =
  /^delivered\+[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+@resend\.dev$/i;

export const isSyntheticE2EEmailRecipient = (email: string): boolean =>
  magicLinkSyntheticRecipientPattern.test(email);

/**
 * Code for the sole authorized bearer-link log in synthetic protected Preview.
 */
export const magicLinkPreviewE2ELogCode = "account.magic-link.preview-e2e";

/** Non-secret correlation identity shared by Workspace magic-link messages. */
export const accountMagicLinkEmailCategoryTag = "account-magic-link";
export const accountMagicLinkEmailSurface = "workspace";
