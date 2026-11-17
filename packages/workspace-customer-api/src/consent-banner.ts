/**
 * The site's cookie consent banner revision, the value of the Workspace's
 * `getConsentBannerRevision()`. A consent cookie holds a choice for the site,
 * its server and the app's web bundle (which share the cookie on one origin)
 * only when saved under this revision. It changes whenever the privacy notice
 * or cookie policy changes in any locale; the Workspace's test of
 * `getConsentBannerRevision` pins it to this value, so the two never differ.
 */
export const consentBannerRevision = 231_430_550_889_094;
