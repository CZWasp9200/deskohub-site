import { env } from "@/env";
import { sendDueMembershipEmails } from "@/features/membership/backend/membership-emails.server";

const isAuthorizedCronRequest = (request: Request, cronSecret: string) =>
  request.headers.get("authorization") === `Bearer ${cronSecret}`;

/**
 * GET /api/cron/membership-emails
 *
 * Scheduled job that emails members: a confirmation once the operator has
 * approved their membership and a reminder a week before it ends.
 */
export async function GET(request: Request): Promise<Response> {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: "Membership emails are not configured" },
      { status: 503 }
    );
  }
  if (!isAuthorizedCronRequest(request, cronSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await sendDueMembershipEmails();
  if (!run) {
    // No accounts database on this deployment: nothing to send.
    return Response.json({ skipped: true });
  }
  // A failed send is retried next time; report it so the run shows as failed.
  return Response.json(run, { status: run.failed > 0 ? 500 : 200 });
}
