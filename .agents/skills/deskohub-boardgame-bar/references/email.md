# Resend Email Service Setup

## Overview

Email delivery is routed by recipient in `@deskohub/email`; there is no
provider setting.

- Mail addressed only to recipients on `EMAIL_TEST_DOMAIN` goes to the Console
  provider, which logs it and never sends.
- All other mail goes to Resend, including `resend.dev`, Resend's simulator
  for delivered, bounced, or complained outcomes. Without `EMAIL_API_KEY` it
  fails with `EmailDeliveryUnconfiguredError` instead of falling back to
  Console.
- A missing or invalid `EMAIL_TEST_DOMAIN` fails startup and the email config
  layer; nothing is routed without it.
- Staff notifications follow the submitter: a test-domain submitter's copy goes
  to `boardgame-staff@<EMAIL_TEST_DOMAIN>` (Console), and every other
  submission reaches the real contact or reservation mailbox in every
  environment (`shared/backend/email/staff-email-recipients.ts`). Outside
  production (`NEXT_PUBLIC_VERCEL_ENV` other than `production`) their subject
  carries the `[TESTING]` tag.

## Required Configuration

Add to `.env.local` for the Boardgame Bar app, or to the app's deployment env:

```bash
EMAIL_API_KEY=re_...
EMAIL_TEST_DOMAIN=deskohub.test
```

`EMAIL_TEST_DOMAIN` must be the same reserved, undeliverable domain in every
environment and app. For local development without a key, use test-domain
recipients.

## Tests

Tests build every address with `testEmailAddress` or `resendSimulatorAddress`
from `@deskohub/email/testing`; the `no-test-email-literals` lint rule rejects
hand-written addresses. `bunfig.toml` preloads
`@deskohub/email/testing/environment`, which supplies the test domain.

## Sender Addresses

Sender/recipient defaults come from `shared/utils/constants.ts`:

- From address: `siteConstants.contact.fromEmail` (default `noreply@mail.deskohub.cz`)
- Reservation mailbox: `siteConstants.contact.reservationEmail`

These are not locale-specific sender addresses in the current implementation.

## Verification

1. Exercise the current contact or training-room request flow with synthetic data.
2. Confirm the send result names the Console or Resend provider.
3. For Resend deliveries, verify them in the Resend dashboard.

## Production Notes

- Verify your sending domain in Resend.
