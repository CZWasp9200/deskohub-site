import { env } from "@/env";
import { deleteExpiredSignInData } from "@/features/account/backend/account-cleanup.server";
import { sendDueMembershipEmails } from "@/features/membership/backend/membership-emails.server";

/** Sending can take a while per email; leave room for a handful of them. */
export const maxDuration = 60;

const isAuthorizedCronRequest = (request: Request, cronSecret: string) =>
  request.headers.get("authorization") === `Bearer ${cronSecret}`;

/**
 * GET /api/cron/accounts
 *
 * Daily job for customer accounts: emails members (a payment confirmation
 * once the operator has approved a membership and a reminder a week before
 * it ends) and deletes expired sign-in data.
 */
export async function GET(request: Request): Promise<Response> {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: "Account jobs are not configured" },
      { status: 503 }
    );
  }
  if (!isAuthorizedCronRequest(request, cronSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cleanup = await deleteExpiredSignInData();
  const emails = await sendDueMembershipEmails();
  if (!(cleanup && emails)) {
    // Accounts are off on this deployment: nothing to do.
    return Response.json({ skipped: true });
  }
  // A failed send is retried next time; report it so the run shows as failed.
  return Response.json(
    { cleanup, emails },
    { status: emails.failed > 0 ? 500 : 200 }
  );
}
