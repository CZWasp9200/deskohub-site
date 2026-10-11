# Resend Email Service Setup

## Overview

Email delivery is routed by recipient in `@deskohub/email`; there is no
provider setting.

- Mail addressed only to `@resend.dev` test recipients goes to the Console
  provider, which logs it and never sends.
- All other mail goes to Resend. Without `EMAIL_API_KEY` it fails with
  `EmailDeliveryUnconfiguredError` instead of falling back to Console.
- Staff notifications follow the submitter: a `resend.dev` submitter's copy
  goes to `delivered+boardgame-staff@resend.dev` (Console), and every other
  submission reaches the real contact or reservation mailbox in every
  environment (`shared/backend/email/staff-email-recipients.ts`). Outside
  production (`NEXT_PUBLIC_VERCEL_ENV` other than `production`) their subject
  carries the `[TESTING]` tag.

## Required Configuration

Add to `.env.local` for the Boardgame Bar app, or to the app's deployment env:

```bash
EMAIL_API_KEY=re_...
```

For local development without a key, use `@resend.dev` recipients such as
`delivered@resend.dev`.

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
